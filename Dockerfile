FROM node:22-alpine
WORKDIR /app
COPY public ./public
COPY llm.mjs server.mjs package.json ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.mjs"]
