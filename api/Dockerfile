FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY db ./db
COPY certs ./certs
USER node
EXPOSE 3000
# Applies the schema (idempotent) and loads demo data when SEED_DEMO_DATA=true, then starts the API.
CMD ["sh", "-c", "node db/init.js && if [ \"$SEED_DEMO_DATA\" = \"true\" ]; then node db/seed.js; fi && node src/server.js"]
