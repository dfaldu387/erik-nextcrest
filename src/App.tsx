import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AccountScopeProvider } from '@/lib/accountScope';
import { Layout } from '@/components/layout/Layout';
import { queryClient } from '@/lib/queryClient';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { SignIn } from '@/pages/SignIn';
import { Campaigns } from '@/pages/Campaigns';
import { CommandCenter } from '@/pages/CommandCenter';
import { DataPurchases } from '@/pages/DataPurchases';
import { DataPurchaseDetail } from '@/pages/DataPurchaseDetail';
import { CheckBeforeBuying } from '@/pages/CheckBeforeBuying';
import { SearchAndBuy } from '@/pages/SearchAndBuy';
import { DuplicateChecker } from '@/pages/DuplicateChecker';
import { FollowUpQueue } from '@/pages/FollowUpQueue';
import { ImportExport } from '@/pages/ImportExport';
import { Inbox } from '@/pages/Inbox';
import { Integrations } from '@/pages/Integrations';
import { Lists } from '@/pages/Lists';
import { NotFound } from '@/pages/NotFound';
import { PropertyDetail } from '@/pages/PropertyDetail';
import { Records } from '@/pages/Records';
import { AllAccountsOnly } from '@/components/layout/AllAccountsOnly';
import { Reports } from '@/pages/Reports';
import { Responders } from '@/pages/Responders';
import { Settings } from '@/pages/Settings';
import { SuppressionPage } from '@/pages/SuppressionPage';
import { Team } from '@/pages/Team';

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AccountScopeProvider><BrowserRouter>
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<CommandCenter />} />
            <Route path="/properties" element={<Records />} />
            <Route path="/properties/:id" element={<PropertyDetail />} />
            <Route path="/purchases" element={<AllAccountsOnly name="Data Purchases"><DataPurchases /></AllAccountsOnly>} />
            <Route path="/purchases/:id" element={<AllAccountsOnly name="Data Purchases"><DataPurchaseDetail /></AllAccountsOnly>} />
            <Route path="/check-before-buying" element={<AllAccountsOnly name="Check Before Buying"><CheckBeforeBuying /></AllAccountsOnly>} />
            <Route path="/search-buy" element={<AllAccountsOnly name="Search &amp; Buy"><SearchAndBuy /></AllAccountsOnly>} />
            <Route path="/duplicates" element={<AllAccountsOnly name="Duplicate Checker"><DuplicateChecker /></AllAccountsOnly>} />
            <Route path="/lists" element={<Lists />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/followups" element={<FollowUpQueue />} />
            <Route path="/responders" element={<Responders />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route
              path="/optouts"
              element={
                <SuppressionPage
                  status="opted_out"
                  title="Opt-outs"
                  description="Owners who asked not to be contacted. They are never included in any export."
                  note="Opt-out reasons and dates are recorded once SmarterContact history is connected."
                />
              }
            />
            <Route
              path="/wrong-numbers"
              element={
                <SuppressionPage
                  status="wrong_number"
                  title="Wrong Numbers"
                  description="Phone numbers that reached the wrong person. Excluded from campaigns until a corrected number is verified."
                  note="Re-verifying a corrected number needs the database. Until then, these records stay excluded."
                />
              }
            />
            <Route path="/import-export" element={<AllAccountsOnly name="Import and Export"><ImportExport /></AllAccountsOnly>} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/team" element={<Team />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/records" element={<Navigate to="/properties" replace />} />
            <Route path="/markets" element={<Navigate to="/purchases" replace />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter></AccountScopeProvider>
    </QueryClientProvider>
  );
}

export default App;
