import { BrowserRouter, Outlet, Route, Routes } from "react-router-dom";
import { WalletProvider } from "./features/wallet/WalletContext";
import BottomNavigation from "./components/BottomNav";
import PactHeader from "./components/PactHeader";
import Home from "./pages/Home";
import Pay from "./pages/Pay";
import Confirm from "./pages/Confirm";
import Activity from "./pages/Activity";
import PolicyPage from "./pages/PolicyPage";
import Recipients from "./pages/Recipients";
import Settings from "./pages/Settings";

function Shell() {
  return (
    <div className="app">
      <PactHeader />
      <main className="page">
        <Outlet />
      </main>
      <BottomNavigation />
    </div>
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
