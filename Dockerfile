FROM node:20-slim
ENV NODE_ENV=production PORT=7860
WORKDIR /home/node/app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node . .
USER node
EXPOSE 7860
CMD ["npm", "start"]
