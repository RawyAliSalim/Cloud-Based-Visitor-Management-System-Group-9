const mongoose = require('mongoose');

const cached = global.mongooseCache || { promise: null };
global.mongooseCache = cached;

async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set');
  }

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
      .catch((error) => {
        cached.promise = null;
        throw error;
      });
  }

  await cached.promise;
  return mongoose.connection;
}

module.exports = connectDB;
