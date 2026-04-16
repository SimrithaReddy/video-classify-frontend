import { Navigate, Route, Routes } from "react-router-dom";
import AuthPage from "./components/AuthPage";
import DashboardPage from "./components/DashboardPage";
import { useAuth } from "./context/AuthContext";

function Protected({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

export default function App() {
  const { token } = useAuth();
  return (
    <Routes>
      <Route path="/auth" element={token ? <Navigate to="/dashboard" replace /> : <AuthPage />} />
      <Route
        path="/dashboard"
        element={
          <Protected>
            <DashboardPage />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to={token ? "/dashboard" : "/auth"} replace />} />
    </Routes>
  );
}
