FROM node:22-slim
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY index.cjs .
EXPOSE 3458
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:3458/health || exit 1
CMD ["node", "index.cjs"]
