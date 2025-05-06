import fs from 'fs/promises'
import path from 'path'
import { Feed } from 'feed'
import fetch from 'node-fetch'
import * as cheerio from 'cheerio'
import puppeteer from 'puppeteer'
import { head, put } from '@vercel/blob';
import { fileURLToPath } from 'url';
import { dirname } from 'path';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 修改环境变量检查
const isVercel = process.env.VERCEL === '1';

// getpagehtml

import { Buffer } from 'buffer';

async function getPageHtml(sdd) {
  // 默认配置
  const defaultConfig = {
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    encoding: 'gbk', // 中文网站常用gbk/gb18030编码
    timeout: 30000, // 30秒超时
    waitUntil: 'networkidle2' // 更宽松的加载条件
  };

  // 合并配置
  const config = { ...defaultConfig, ...sdd };

  if (config.suggest_fetch_method === 'headless') {
    // Headless 模式抓取
    const browser = await puppeteer.launch({ 
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // Vercel 环境需要的参数
    });
    
    try {
      const page = await browser.newPage();
      
      // 设置视窗和User-Agent
      await page.setViewport({ 
        width: config.viewport?.width || 1280, 
        height: config.viewport?.height || 800 
      });
      
      await page.setUserAgent(config.user_agent);
      
      // 设置请求拦截，避免加载不必要资源
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });

      // 导航并等待
      await page.goto(config.url, { 
        waitUntil: config.waitUntil,
        timeout: config.timeout
      });
      
      // 获取HTML内容
      const html = await page.content();
      return html;
    } finally {
      await browser.close();
    }
  } else {
   
    // 普通fetch模式
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeout);
      
      const response = await fetch(config.url, {
        headers: {
          'User-Agent': config.user_agent,
          'Accept-Charset': 'gbk, utf-8;q=0.7, *;q=0.3',
          'Accept': 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      
      // 动态导入iconv-lite
      const iconv = (await import('iconv-lite')).default;
      
      // 尝试多种中文编码
      const encodingsToTry = ['gbk', 'gb18030', 'gb2312', 'utf-8'];
      let decodedContent = '';
      
      for (const encoding of encodingsToTry) {
        try {
          decodedContent = iconv.decode(Buffer.from(buffer), encoding);
          // 简单验证是否解码成功（检查常见中文字符）
          if (/[\u4e00-\u9fa5]/.test(decodedContent)) {
            console.log(`Success with encoding: ${encoding}`);
            console.log('Sample content:', decodedContent.substring(0, 200));
            return decodedContent;
          }
        } catch (e) {
          console.warn(`Failed with encoding ${encoding}:`, e.message);
        }
      }
      
      throw new Error('Failed to decode content with any of the tried encodings');
      
    } catch (error) {
      console.error('Fetch error:', error);
      throw new Error(`Failed to fetch ${config.url}: ${error.message}`);
    }
  }
}


// 缓存工具函数
async function getCacheKey(name) {
  return {
    content: `cache_${name}_feed.xml`,
    metadata: `cache_${name}_metadata.json`
  };
}

async function getCache(name) {
  const cacheKey = await getCacheKey(name);
  try {
    if (isVercel) {
      // 检查内容和元数据是否存在
      const [contentMeta, metadataMeta] = await Promise.all([
        head(cacheKey.content, { token: process.env.BLOB_READ_WRITE_TOKEN }),
        head(cacheKey.metadata, { token: process.env.BLOB_READ_WRITE_TOKEN })
      ]);
      
      if (!contentMeta || !metadataMeta) return null;
      
      // 获取元数据文件
      const metadataResponse = await fetch(metadataMeta.downloadUrl);
      const metadata = await metadataResponse.json();
      
      // 检查缓存是否过期
      const cacheAge = Date.now() - metadata.timestamp;
      const cacheMinutes = parseInt(process.env.CACHE_MINUTES || '0');
      
      if (cacheMinutes > 0 && cacheAge < cacheMinutes * 60 * 1000) {
        const response = await fetch(contentMeta.downloadUrl);
        return await response.text();
      }
    } else {
      // 本地文件系统缓存
      const cacheDir = path.join(__dirname, 'cache');
      const cachePath = path.join(cacheDir, cacheKey.content);
      
      try {
        const stats = await fs.stat(cachePath);
        const cacheAge = Date.now() - stats.mtime.getTime();
        const cacheMinutes = parseInt(process.env.CACHE_MINUTES || '0');
        
        if (cacheMinutes > 0 && cacheAge < cacheMinutes * 60 * 1000) {
          return await fs.readFile(cachePath, 'utf-8');
        }
      } catch (error) {
        // 文件不存在或其他错误，返回null
        return null;
      }
    }
  } catch (error) {
    console.error('Cache read error:', error);
    return null;
  }
  return null;
}

async function setCache(name, content) {
  const cacheKey = await getCacheKey(name);
  try {
    if (isVercel) {
      // 并行写入内容和元数据
      await Promise.all([
        put(cacheKey.content, content, {
          access: 'public',
          token: process.env.BLOB_READ_WRITE_TOKEN,
          contentType: 'application/xml',
          addRandomSuffix: false
        }),
        put(cacheKey.metadata, JSON.stringify({
          timestamp: Date.now()
        }), {
          access: 'public',
          token: process.env.BLOB_READ_WRITE_TOKEN,
          contentType: 'application/json',
          addRandomSuffix: false
        })
      ]);
    } else {
      // 本地文件系统缓存
      const cacheDir = path.join(__dirname, 'cache');
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(path.join(cacheDir, cacheKey.content), content);
    }
  } catch (error) {
    console.error('Cache write error:', error);
  }
}

// URL处理工具函数
function normalizeUrl(url, baseUrl) {
  if (!url) return url;
  
  // 如果已经是完整URL，直接返回
  if (url.startsWith('http')) {
    return url;
  }
  
  // 处理相对URL
  try {
    const base = new URL(baseUrl);
    return new URL(url, base.origin).toString();
  } catch (e) {
    console.error('URL normalization error:', e);
    return url;
  }
}

export async function getFeed(name) {
  // 检查缓存
  const cachedContent = await getCache(name);
  if (cachedContent) {
    return cachedContent;
  }

  let sdd;

  if (isVercel) {
    const metadata = await head(`${name}.sdd.json`, {
      token: process.env.BLOB_READ_WRITE_TOKEN,
    })
    console.log("metadata", metadata);
    const sddContent = await fetch(metadata.downloadUrl).then(res => res.text())
    sdd = JSON.parse(sddContent);
  } else {
    // 读取 SDD 文件
    const sddPath = path.join(__dirname, 'sdd', `${name}.sdd.json`)
    const sddContent = await fs.readFile(sddPath, 'utf-8')
    sdd = JSON.parse(sddContent);
  }

  // 获取网页内容
  const html = await getPageHtml(sdd)
  
  // 使用 cheerio 解析 HTML
  const $ = cheerio.load(html)
  
  // 创建 Feed
  const feed = new Feed({
    title: sdd.rss.channel.title,
    description: sdd.title,
    id: sdd.url,
    link: sdd.url,
    language: sdd.rss.channel.language,
    favicon: sdd.favicon,
    generator: sdd.rss.channel.generator
  })

  // 解析列表项
  const items = $(sdd.data_list.selector.css)
  console.log(`🎯 找到 ${items.length} 条数据 using selector: ${sdd.data_list.selector.css}`)

  // 处理 un_selectors - 移动到列表选择之后，items处理之前
  if (sdd.data_list.un_selectors && sdd.data_list.un_selectors.length > 0) {
    items.each((_, element) => {
      sdd.data_list.un_selectors.forEach(selector => {
        $(element).find(selector).remove()
      })
    })
  }

  const feedItems = [];
  items.each((_, element) => {
    const $element = $(element)
    const item = {}
    
    // 解析每个字段
    for (const [field, config] of Object.entries(sdd.data_list_elements)) {
      let value = null;
      
      if (config.type === 'var') {
        // 处理变量类型
        const varPath = config.value.split('.')
        if (varPath[0] === 'meta') {
          const metaConfig = sdd.meta[varPath[1]]
          const metaEl = $(metaConfig.selector.css)
          value = metaConfig.type === 'text' ? metaEl.text().trim() : metaEl.attr(metaConfig.value)
        }
      } else {
        const el = $element.find(config.selector.css)
        
        // 处理字段级别的 un_selectors
        if (config.un_selectors && config.un_selectors.length > 0) {
          config.un_selectors.forEach(selector => {
            el.find(selector).remove()
          })
        }

        if (config.type === 'attr') {
          value = el.attr(config.value)
        } else if (config.type === 'text') {
          value = el.text().trim()
        } else if (config.type === 'image') {
          value = el.attr('src')
        }
      }
      
      item[field] = value
    }

    // 补全 URL
    if (item.link && !item.link.startsWith('http')) {
      const baseUrl = new URL(sdd.url)
      item.link = item.link.startsWith('/') 
        ? `${baseUrl.origin}${item.link}`
        : `${baseUrl.origin}/${item.link}`
    }

    // 补全图片 URL
    if (item.image && !item.image.startsWith('http')) {
      const baseUrl = new URL(sdd.url)
      item.image = item.image.startsWith('/') 
        ? `${baseUrl.origin}${item.image}`
        : `${baseUrl.origin}/${item.image}`
    }

    feedItems.push(item)
  })

  // 添加到 Feed
  feedItems.forEach(item => {
    const baseUrl = new URL(sdd.url);
    
    feed.addItem({
      title: item[sdd.rss.items.title],
      id: item[sdd.rss.items.guid] || normalizeUrl(item[sdd.rss.items.link], baseUrl),
      link: normalizeUrl(item[sdd.rss.items.link], baseUrl),
      description: item[sdd.rss.items.description],
      date: item[sdd.rss.items.date] ? new Date(item[sdd.rss.items.date]) : new Date(),
      ...(sdd.rss.items.cover && item[sdd.rss.items.cover] && {
        enclosure: {
          url: normalizeUrl(item[sdd.rss.items.cover], baseUrl),
          type: 'image/jpeg'
        }
      })
    })
  })

  const feedContent = feed.rss2();
  
  // 设置缓存
  if (process.env.CACHE_MINUTES) {
    await setCache(name, feedContent);
  }
  
  return feedContent;
} 
