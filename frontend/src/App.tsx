import { Navigate, Route, Routes } from 'react-router';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';

// Spec §1.3 routes; the default after login is /receiving.
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/receiving" element={<p>Receiving documents</p>} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/receiving" replace />} />
    </Routes>
  );
}
