import axios from 'axios';

let baseURL = 'http://127.0.0.1:3000';
let authToken = '';

export function setBaseURL(port) {
  baseURL = `http://127.0.0.1:${port}`;
}

export function setAuthToken(token) {
  authToken = token;
}

const client = axios.create({
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

client.interceptors.request.use((config) => {
  config.baseURL = baseURL;
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.error || error.message;
    const code = error.response?.data?.code || 'ERR_UNKNOWN';
    return Promise.reject({ message, code, status: error.response?.status });
  }
);

export default client;
