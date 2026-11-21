import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, tokens } from './api.js';
import { PageLoading } from './ui.jsx';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!tokens.user);

  useEffect(() => {
    if (tokens.user) {
      api.get('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false));
    }
    const onLogout = () => setUser(null);
    window.addEventListener('nijaat:logout', onLogout);
    return () => window.removeEventListener('nijaat:logout', onLogout);
  }, []);

  const login = useCallback((token, nextUser) => { tokens.user = token; setUser(nextUser); }, []);
  const logout = useCallback(() => { tokens.user = null; setUser(null); }, []);

  return <AuthContext.Provider value={{ user, setUser, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div style={{ padding: 32 }}><PageLoading /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}
