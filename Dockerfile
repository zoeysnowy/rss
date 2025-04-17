FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json (如果存在)
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制 api 目录
COPY api ./api

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["node", "api/index.js"] 