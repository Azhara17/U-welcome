import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'
import './index.css'
import { CheckinPage } from './pages/CheckinPage'
import { DashboardPage } from './pages/DashboardPage'
import { EventPage } from './pages/EventPage'
import { Home } from './pages/Home'
import { MyTicketPage } from './pages/MyTicketPage'
import { TicketPage } from './pages/TicketPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/events/:id" element={<EventPage />} />
        <Route path="/tickets/:token" element={<TicketPage />} />
        <Route path="/my-ticket" element={<MyTicketPage />} />
        <Route path="/organizer" element={<Home organizer />} />
        <Route path="/organizer/events/:id" element={<DashboardPage />} />
        <Route path="/organizer/events/:id/checkin" element={<CheckinPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
