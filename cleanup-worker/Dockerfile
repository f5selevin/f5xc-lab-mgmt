FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY worker.mjs dashboard.mjs ./

USER node
EXPOSE 8080
CMD ["npm", "start"]
