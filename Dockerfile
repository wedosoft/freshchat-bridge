# Use official Node.js LTS image
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Create uploads directory
RUN mkdir -p uploads

# Bundle app source
COPY poc-bridge.js ./
COPY public ./public
COPY scripts ./scripts

# Expose port 3978
EXPOSE 3978

# Start the application
CMD ["node", "poc-bridge.js"]
