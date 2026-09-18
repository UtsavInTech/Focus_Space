import { useEffect, useState } from 'react';
import { usePath } from './router';
import { initialCurrency, rememberCurrency } from './currency';
import type { CurrencyCode } from './content/plans';
import { SiteNav } from './components/SiteNav';
import { Hero } from './components/Hero';
import { FeatureTabs } from './components/FeatureTabs';
import { PricingSection } from './components/PricingSection';
import { Faq } from './components/Faq';
import { Footer } from './components/Footer';
import { ChatLauncher } from './components/ChatLauncher';

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
    document.title = path === '/pricing' ? 'Pricing — FocusSpace' : 'FocusSpace — YouTube, organised around what you came for';
  }, [path]);

  const isPricing = path === '/pricing';

  return (
    <>
      <SiteNav />
      <main id="main">
        {isPricing ? (
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
            <FeatureTabs />
            <PricingSection currency={currency} onCurrency={chooseCurrency} compact />
            <Faq />
          </>
        )}
      </main>
      <Footer />
      <ChatLauncher />
    </>
  );
}
