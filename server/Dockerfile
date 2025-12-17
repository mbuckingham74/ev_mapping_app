# Build stage
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Copy package files and install production deps only
COPY package.json ./
RUN npm install --omit=dev

# Copy built app
COPY --from=build /app/dist ./dist

EXPOSE 3001

CMD ["node", "dist/index.js"]
