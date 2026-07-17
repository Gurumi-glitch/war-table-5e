import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LocaleProvider } from "./i18n";
import { Home } from "./pages/Home";
import { Frontstage } from "./pages/Frontstage";
import { Backstage } from "./pages/Backstage";

export function App() {
  return (
    <LocaleProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/play/:playerToken" element={<Frontstage />} />
          <Route path="/dm/:playerToken/:dmToken" element={<Backstage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </LocaleProvider>
  );
}
