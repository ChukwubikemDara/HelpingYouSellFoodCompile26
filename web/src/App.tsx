import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { DealDetail } from './pages/DealDetail'
import { DealList } from './pages/DealList'

function NotFound() {
  return <p className="py-10 text-center text-stone-500">Page not found.</p>
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DealList />} />
          <Route path="deals/:id" element={<DealDetail />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
