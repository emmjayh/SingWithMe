# Stage 1: Build the application
FROM node:18-alpine AS builder
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Serve the application
FROM node:18-alpine
WORKDIR /app

# Copy the built application from the builder stage
COPY --from=builder /app/dist ./dist
COPY package.json .
RUN npm install --omit=dev

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["npm", "run", "start:web", "--", "-p", "3000"]