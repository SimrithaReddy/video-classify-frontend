import axios from "axios";

export const API_BASE_URL = "http://localhost:5000/api";
// export const API_BASE_URL = "https://video-classify-backend.onrender.com/api";

export const api = axios.create({
  baseURL: API_BASE_URL,
});

let authExpiredHandler: (() => void) | null = null;

export function registerAuthExpiredHandler(handler: (() => void) | null) {
  authExpiredHandler = handler;
}

export function attachToken(token: string | null) {
  if (!token) {
    delete api.defaults.headers.common.Authorization;
    return;
  }
  api.defaults.headers.common.Authorization = `Bearer ${token}`;
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error?.response?.data?.message;
    if (message === "Invalid or expired token") {
      authExpiredHandler?.();
    }

    return Promise.reject(error);
  }
);
