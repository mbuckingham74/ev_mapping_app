import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { PlanningPage, OnRoadPage } from './pages';

function App() {
  return (
    <BrowserRouter>
      <div className="h-screen flex flex-col">
        {/* Navigation */}
        <nav className="bg-slate-900 border-b border-slate-700">
          <div className="flex items-center justify-between px-4">
            <div className="flex items-center gap-1">
              <NavLink
                to="/"
                className={({ isActive }) =>
                  `px-4 py-3 text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-white border-b-2 border-blue-500'
                      : 'text-slate-400 hover:text-white'
                  }`
                }
              >
                Planning
              </NavLink>
              <NavLink
                to="/onroad"
                className={({ isActive }) =>
                  `px-4 py-3 text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-white border-b-2 border-blue-500'
                      : 'text-slate-400 hover:text-white'
                  }`
                }
              >
                On-Road
              </NavLink>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                Electrify America Route Planner
              </span>
            </div>
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<PlanningPage />} />
            <Route path="/onroad" element={<OnRoadPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
