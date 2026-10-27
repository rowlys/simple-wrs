import { Navigate, Outlet } from 'react-router';
import { useAuth } from './AuthProvider';

export function ProtectedRoute() {
  return useAuth().user ? <Outlet /> : <Navigate to="/login" replace />;
}
