import { useEffect, useState } from 'react';
import { ArrowRight, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../auth';
import { instituteRequest, type Org } from '../institute-api';
import { navigate, onLinkClick } from '../router';
import './institute-tools.css';

/**
 * Institute owners, admins and faculty work in their own dashboard. Straight after signing in they are taken
 * there; any other time, the account page offers the way in. Nothing shows for everyone else.
 */
export function StaffLanding() {
  const auth = useAuth();
  const [orgs, setOrgs] = useState<Org[]>([]);

  useEffect(() => {
    if (!auth.user) return;
    let live = true;
    void auth
      .token()
      .then((token) => (token ? instituteRequest<{ orgs: Org[] }>(token, '/v1/institutes/access') : { orgs: [] }))
      .then((access) => {
        if (!live) return;
        setOrgs(access.orgs);
        const fromSignIn = new URLSearchParams(location.search).get('from') === 'signin';
        if (fromSignIn && access.orgs.length) navigate('/studio');
      })
      // Institute services may be off on this server; the account page works without them.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [auth.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!orgs.length) return null;
  return (
    <a className="fsw-staff-landing" href="/studio" onClick={onLinkClick('/studio')}>
      <LayoutDashboard size={22} aria-hidden="true" />
      <span>
        <b>Open your institute dashboard</b>
        <small>{orgs.map((o) => o.name).join(', ')}: students, requests, courses and the morning brief.</small>
      </span>
      <ArrowRight size={18} aria-hidden="true" />
    </a>
  );
}
