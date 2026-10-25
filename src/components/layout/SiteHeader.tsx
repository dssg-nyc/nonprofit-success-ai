import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import type { AppUser } from "../../lib/supabase";
import { GoogleLogo } from "../auth/GoogleLogo";

// Markup and class names mirror the website header (dssg-nyc.github.io Header.jsx);
// the styles live in src/app/index.css under "Site header".

interface SiteHeaderProps {
  user: AppUser | null;
  isAdmin: boolean;
  isGoogle?: boolean;
  onLogout: () => void;
}

export default function SiteHeader({ user, isAdmin, isGoogle, onLogout }: SiteHeaderProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const closeMenu = () => setIsMenuOpen(false);

  return (
    <header className={`modern-header ${isScrolled ? "scrolled" : ""}`}>
      <div className="header-container">
        <div className="logo-section">
          <Link to="/" className="logo-link" onClick={closeMenu}>
            <img src="/images/logo3.png" alt="" className="logo-img" />
            <span className="logo-text">
              <span className="logo-title">NYC-DSSG</span>
              <span className="logo-subtitle">Success Portal</span>
            </span>
          </Link>
        </div>

        <button
          type="button"
          className={`nav-toggle ${isMenuOpen ? "is-open" : ""}`}
          aria-label={isMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={isMenuOpen}
          aria-controls="primary-nav"
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          <span className="nav-toggle-bar" aria-hidden="true" />
          <span className="nav-toggle-bar" aria-hidden="true" />
          <span className="nav-toggle-bar" aria-hidden="true" />
        </button>

        <nav id="primary-nav" className={`nav-menu ${isMenuOpen ? "is-open" : ""}`} aria-label="Main navigation">
          {user ? (
            <>
              <NavLink to="/dashboard" className="nav-link" onClick={closeMenu}>
                Overview
              </NavLink>
              {/* Staff validate 501(c)(3) status in Admin Review, not through the applicant gate. */}
              {!isAdmin && (
                <NavLink to="/onboarding" className="nav-link" onClick={closeMenu}>
                  501(c)(3) Intake
                </NavLink>
              )}
              {isAdmin && (
                <NavLink to="/admin" className="nav-link" onClick={closeMenu}>
                  Admin Review
                </NavLink>
              )}
              {isAdmin && (
                <NavLink to="/projects" className="nav-link" onClick={closeMenu}>
                  Ongoing Projects
                </NavLink>
              )}
              <NavLink to="/apply" className="nav-link" onClick={closeMenu}>
                Apply
              </NavLink>

              <span className="nav-divider" aria-hidden="true" />

              <div className="nav-user">
                <div className="nav-user-meta">
                  <span className="nav-user-email">{user.email}</span>
                  <span className="nav-user-role">
                    {isAdmin ? "DSSG Admin" : "Active Client"}
                    {isGoogle && (
                      <>
                        {" "}
                        <GoogleLogo className="inline w-2.5 h-2.5" /> Google Verified
                      </>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className="nav-logout"
                  title="Logout"
                  aria-label="Log out"
                  onClick={() => {
                    closeMenu();
                    onLogout();
                  }}
                >
                  Log out
                </button>
              </div>
            </>
          ) : (
            <>
              <NavLink to="/apply" className="nav-link" onClick={closeMenu}>
                Apply
              </NavLink>
              <Link to="/login" className="nav-link button-nav" onClick={closeMenu}>
                Client Access
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
