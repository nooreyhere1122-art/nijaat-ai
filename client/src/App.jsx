import { Route, Routes, Navigate, Link } from 'react-router-dom';
import { RequireAuth } from './auth.jsx';
import Shell from './Shell.jsx';
import { Landing, Scanner, EmergencyScan, AlertView } from './pages/Public.jsx';
import HospitalsPage from './pages/Hospitals.jsx';
import { PhysicianAccess, PhysicianRecord } from './pages/Physician.jsx';
import { Register, VerifyPending, VerifyEmail, Login, ForgotPassword, ResetPassword } from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { ProfilePage, ContactsPage } from './pages/Profile.jsx';
import { QrPage, ActivityPage } from './pages/Qr.jsx';
import { ReportsPage, ReportDetail, ComparePage } from './pages/Reports.jsx';
import { PrescriptionsPage, VerifyPrescription } from './pages/Prescriptions.jsx';
import Settings from './pages/Settings.jsx';

function NotFound() {
  return (
    <div className="auth-wrap">
      <div className="bg-wash" />
      <div className="glass auth-card stack center">
        <h1>Page not found</h1>
        <p className="muted">The address may be mistyped, or the page has moved.</p>
        <Link className="btn btn-primary" to="/">Go to the start page</Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <Routes>
        {/* Public emergency zone: no login */}
        <Route path="/" element={<Landing />} />
        <Route path="/scan" element={<Scanner />} />
        <Route path="/e/:token" element={<EmergencyScan />} />
        <Route path="/a/:viewToken" element={<AlertView />} />
        <Route path="/hospitals" element={<HospitalsPage standalone />} />

        {/* Clinical zone: one-time code */}
        <Route path="/physician" element={<PhysicianAccess />} />
        <Route path="/physician/record" element={<PhysicianRecord />} />

        {/* Authentication */}
        <Route path="/register" element={<Register />} />
        <Route path="/verify-pending" element={<VerifyPending />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Account zone */}
        <Route path="/app" element={<RequireAuth><Shell /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="qr" element={<QrPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="reports/compare" element={<ComparePage />} />
          <Route path="reports/:id" element={<ReportDetail />} />
          <Route path="prescriptions" element={<PrescriptionsPage />} />
          <Route path="prescriptions/:id" element={<VerifyPrescription />} />
          <Route path="hospitals" element={<HospitalsPage />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
