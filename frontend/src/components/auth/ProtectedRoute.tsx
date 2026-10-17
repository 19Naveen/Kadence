import { Navigate, useLocation } from "react-router-dom";
import { ReactNode } from "react";
import { useAuthContext } from "../../lib/context/AuthContext";
import { PageLoading } from "../shared/PageLoading";

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuthContext();
  const location = useLocation();

  if (isLoading) return <PageLoading fullScreen />;

  if (!isAuthenticated) {
    return <Navigate to="/signin" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
