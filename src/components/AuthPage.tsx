import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../types";

export default function AuthPage() {
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const formData = new FormData(event.currentTarget);

    try {
      if (mode === "login") {
        await login(String(formData.get("email")), String(formData.get("password")));
      } else {
        await register({
          name: String(formData.get("name")),
          email: String(formData.get("email")),
          password: String(formData.get("password")),
          tenantId: String(formData.get("tenantId")),
          role: String(formData.get("role")) as Role,
        });
      }
      navigate("/dashboard");
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <form onSubmit={onSubmit} className="card auth-card">
        <h1>Video Processing Platform</h1>
        <p>{mode === "login" ? "Sign in to continue." : "Create your tenant account."}</p>
        {mode === "register" && <input required name="name" placeholder="Name" />}
        <input required name="email" type="email" placeholder="Email" />
        <input required name="password" type="password" minLength={6} placeholder="Password" />
        {mode === "register" && (
          <>
            <input required name="tenantId" placeholder="Organization slug (tenant id)" />
            <select name="role" defaultValue="editor">
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
          </>
        )}
        {error && <span className="error">{error}</span>}
        <button disabled={loading} type="submit">
          {loading ? "Working..." : mode === "login" ? "Login" : "Register"}
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? "Need an account? Register" : "Already have an account? Login"}
        </button>
      </form>
    </div>
  );
}
