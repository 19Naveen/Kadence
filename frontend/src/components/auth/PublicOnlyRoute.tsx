import { Navigate } from "react-router-dom";
import { ReactNode } from "react";
import { useAuthContext } from "../../lib/context/AuthContext";
import { PageLoading } from "../shared/PageLoading";

interface PublicOnlyRouteProps {
  children: ReactNode;
}

export function PublicOnlyRoute({ children }: PublicOnlyRouteProps) {
  const { isAuthenticated, isLoading } = useAuthContext();

  if (isLoading) return <PageLoading fullScreen />;

  if (isAuthenticated) {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}
