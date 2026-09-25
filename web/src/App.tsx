import { useEffect, useState } from 'react';
import { usePath } from './router';
import { initialCurrency, rememberCurrency } from './currency';
import type { CurrencyCode } from './content/plans';
import { SiteNav } from './components/SiteNav';
import { Hero } from './components/Hero';
import { FeatureJourney } from './components/FeatureJourney';
import { PricingSection } from './components/PricingSection';
import { Faq } from './components/Faq';
import { Footer } from './components/Footer';
import { ChatLauncher } from './components/ChatLauncher';
import { CursorSparkle } from './components/CursorSparkle';
import { AuthPage } from './components/AuthPage';
import { ConnectPage } from './components/ConnectPage';
import { AccountPage } from './components/AccountPage';
import { LegalPage } from './components/LegalPage';
import { DataSummary } from './components/DataSummary';
import { DataPage } from './components/DataPage';
import { LEGAL_DOCS } from './content/legal';
import { AuthProvider } from './auth';

/**
 * Two pages: the home, and a dedicated pricing page. Both share the nav, the
 * footer and the chat bubble, and both read the same currency choice — a
 * visitor who switches to rupees on the pricing page still sees rupees in the
 * home page's plan summary.
 */
export function App() {
  const path = usePath();
  const [currency, setCurrency] = useState<CurrencyCode>(initialCurrency);

  function chooseCurrency(next: CurrencyCode) {
    setCurrency(next);
    rememberCurrency(next);
  }

  useEffect(() => {
    document.title =
      path === '/pricing'
        ? 'Pricing — FocusSpace'
        : path === '/signin' || path === '/signup' || path === '/reset'
          ? 'Sign in — FocusSpace'
          : path === '/connect'
          ? 'Connecting FocusSpace'
          : path === '/account'
            ? 'Your account — FocusSpace'
            : path === '/data'
              ? 'Your data — FocusSpace'
            : LEGAL_DOCS[path]
              ? `${LEGAL_DOCS[path].title} — FocusSpace`
              : 'FocusSpace — YouTube, organised around what you came for';
  }, [path]);

  const isPricing = path === '/pricing';
  const isAuth = path === '/signin' || path === '/signup' || path === '/reset';
  // Where the extension sends someone to finish signing in — see web/src/connect.ts.
  const isConnect = path === '/connect';
  const isAccount = path === '/account';
  const isData = path === '/data';
  const legal = LEGAL_DOCS[path] ?? null;

  return (
    <AuthProvider>
      <SiteNav />
      <main id="main">
        {legal ? (
          <LegalPage doc={legal} lead={legal.slug === '/privacy' ? <DataSummary /> : undefined} />
        ) : isConnect ? (
          <ConnectPage />
        ) : isAuth ? (
          <AuthPage mode={path === '/signup' ? 'signup' : path === '/reset' ? 'reset' : 'signin'} />
        ) : isData ? (
          <DataPage />
        ) : isAccount ? (
          <AccountPage />
        ) : isPricing ? (
          <>
            <header className="fsw-page-head">
              <h1>Simple plans, honest limits</h1>
              <p>
                The part that makes YouTube usable is free forever. What you pay for is AI — every note, mind map and
                explanation is a real request we pay for on your behalf.
              </p>
            </header>
            <PricingSection currency={currency} onCurrency={chooseCurrency} showCredits />
            <Faq />
          </>
        ) : (
          <>
            <Hero />
            <FeatureJourney />
            <PricingSection currency={currency} onCurrency={chooseCurrency} compact />
            <Faq />
          </>
        )}
      </main>
      {!isAuth && !isConnect && <Footer />}
      <CursorSparkle />
      <ChatLauncher />
    </AuthProvider>
  );
}
