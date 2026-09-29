import { BrowserRouter, Outlet, Route, Routes } from "react-router-dom";
import { WalletProvider } from "./features/wallet/WalletContext";
import BottomNav from "./components/BottomNav";
import WalletButton from "./components/WalletButton";
import Home from "./pages/Home";
import Pay from "./pages/Pay";
import Confirm from "./pages/Confirm";
import Activity from "./pages/Activity";
import PolicyPage from "./pages/PolicyPage";
import Recipients from "./pages/Recipients";
import Settings from "./pages/Settings";

function Shell() {
  return (
    <>
      <header className="app-header">
        <span className="brand">Pact</span>
        <WalletButton />
      </header>
      <main className="page">
        <Outlet />
      </main>
      <BottomNav />
    </>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<Home />} />
            <Route path="/pay" element={<Pay />} />
            <Route path="/confirm/:id" element={<Confirm />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/policy" element={<PolicyPage />} />
            <Route path="/recipients" element={<Recipients />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Home />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </WalletProvider>
  );
}
