import axios from "axios";

export const API_BASE_URL = "https://video-classify-backend.onrender.com"; // "http://localhost:5000/api";

export const api = axios.create({
  baseURL: API_BASE_URL,
});

export function attachToken(token: string | null) {
  if (!token) {
    delete api.defaults.headers.common.Authorization;
    return;
  }
  api.defaults.headers.common.Authorization = `Bearer ${token}`;
}
