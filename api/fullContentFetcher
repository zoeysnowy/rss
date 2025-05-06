import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';

/**
 * 获取页面的完整内容和图片
 * @param {string} url - 要抓取的页面URL
 * @param {object} options - 配置选项
 * @returns {Promise<{content: string, images: string[]}>}
 */
export async function fetchFullContent(url, options = {}) {
  const { timeout = 30000, userAgent = 'Mozilla/5.0' } = options;

  // 使用 puppeteer 获取完整页面
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: 1280, height: 800 });

    // 设置请求拦截，只允许文档和图片
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['document', 'image'].includes(req.resourceType())) {
        req.continue();
      } else {
        req.abort();
      }
    });

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout
    });

    // 获取完整HTML
    const html = await page.content();
    const $ = cheerio.load(html);

    // 提取主要内容区域（可根据需要调整选择器）
    const contentSelector = options.contentSelector || 'body';
    const contentElement = $(contentSelector);
    
    // 清理不需要的元素
    contentElement.find('script, style, iframe, noscript').remove();

    // 提取所有图片
    const images = [];
    contentElement.find('img').each((_, img) => {
      const src = $(img).attr('src');
      if (src && !src.startsWith('data:')) {
        images.push(new URL(src, url).toString());
      }
    });

    // 处理相对链接
    contentElement.find('a').each((_, a) => {
      const href = $(a).attr('href');
      if (href && !href.startsWith('http') && !href.startsWith('#')) {
        $(a).attr('href', new URL(href, url).toString());
      }
    });

    return {
      content: contentElement.html(),
      images
    };
  } finally {
    await browser.close();
  }
}

/**
 * 将图片嵌入到内容中
 * @param {string} content - HTML内容
 * @param {string[]} images - 图片URL数组
 * @returns {string}
 */
export function embedImages(content, images) {
  const $ = cheerio.load(content);
  
  // 在内容开头添加图片展示
  if (images.length > 0) {
    const imagesHtml = images.map(img => 
      `<figure><img src="${img}" alt=""/><figcaption>图片</figcaption></figure>`
    ).join('');
    $('body').prepend(imagesHtml);
  }
  
  return $.html();
}
