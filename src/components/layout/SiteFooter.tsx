// Markup, copy and links mirror the website footer (dssg-nyc.github.io Footer.jsx and
// data/siteproperties.json, socialicons.json). Styles live in src/app/index.css under
// "Site footer". Pages that exist only on the website link out to it.

const SITE = "https://www.nyc-dssg.org";
const VOLUNTEER_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSf8bvJdbx70NBQwizsA2UKAUiZ5AILtc7bWUH0KxOT_ej6MJw/viewform?usp=header";
const ADDRESS = "374 S 2nd Street, Brooklyn, NY 11211, USA";

const NONPROFIT_LINKS = [
  { label: "Partner with us", href: `${SITE}/#projects` },
  { label: "Impact stories", href: `${SITE}/#writing` },
  { label: "Book a call", href: `${SITE}/#book` },
];

const VOLUNTEER_LINKS = [
  { label: "Volunteer with us", href: VOLUNTEER_FORM_URL },
  { label: "Data Diplomats Program", href: `${SITE}/diplomats` },
  { label: "Our work", href: `${SITE}/portfolio` },
  { label: "Events", href: `${SITE}/events` },
];

const CONNECT_LINKS = [
  { label: "GitHub", href: "https://github.com/dssg-nyc" },
  { label: "LinkedIn", href: "https://www.linkedin.com/groups/13349223/" },
  { label: "Substack", href: "https://ai4nonprofits.substack.com/" },
  { label: "dssgnyc@gmail.com", href: "mailto:dssgnyc@gmail.com" },
];

const SOCIAL = [
  { key: "gitHub", href: "https://github.com/dssg-nyc", icon: "/images/social/github.svg" },
  { key: "linkedIn", href: "https://www.linkedin.com/groups/13349223/", icon: "/images/social/linkedin.svg" },
  { key: "substack", href: "https://ai4nonprofits.substack.com/", icon: "/images/social/substack.svg" },
];

const LEGAL_LINKS = [
  { label: "Privacy Policy", href: `${SITE}/privacy` },
  { label: "Cookie Policy", href: `${SITE}/cookies` },
  { label: "AI Policy", href: `${SITE}/ai-policy` },
];

export default function SiteFooter() {
  return (
    <footer className="modern-footer">
      <div className="footer-inner">
        <div className="footer-top">
          <div className="footer-brand">
            <div className="footer-logo">
              <img src="/images/logo3.png" alt="" className="footer-logo-img" />
              <div className="footer-brand-text">
                <span className="footer-brand-name">NYC DSSG</span>
                <span className="footer-brand-sub">Data Science for Social Good</span>
              </div>
            </div>
            <p className="footer-description">
              Data Diplomats for Nonprofits is a 501(c)(3) nonprofit that trains volunteers to bring
              human-centered, frontier AI to mission-driven organizations. Founded in New York City.
            </p>
            <div className="footer-social">
              {SOCIAL.map((item) => (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  key={item.key}
                  className="footer-social-link"
                  aria-label={item.key}
                >
                  <img src={item.icon} alt="" />
                </a>
              ))}
            </div>
          </div>

          <div className="footer-columns">
            <nav className="footer-column" aria-label="For nonprofits">
              <h2 className="footer-column-title">For nonprofits</h2>
              {NONPROFIT_LINKS.map((link) => (
                <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">
                  {link.label}
                </a>
              ))}
            </nav>

            <nav className="footer-column" aria-label="For volunteers">
              <h2 className="footer-column-title">For volunteers</h2>
              {VOLUNTEER_LINKS.map((link) => (
                <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">
                  {link.label}
                </a>
              ))}
            </nav>

            <nav className="footer-column" aria-label="Connect">
              <h2 className="footer-column-title">Connect</h2>
              {CONNECT_LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target={link.href.startsWith("mailto:") ? undefined : "_blank"}
                  rel={link.href.startsWith("mailto:") ? undefined : "noopener noreferrer"}
                >
                  {link.label}
                </a>
              ))}
              <a
                className="footer-donate"
                href="https://givebutter.com/aiforgood"
                target="_blank"
                rel="noopener noreferrer"
              >
                Donate
              </a>
            </nav>
          </div>
        </div>

        <div className="footer-bottom">
          <div className="footer-bottom-copy">
            <p>
              &copy; {new Date().getFullYear()} Data Diplomats for Nonprofits, Inc. — 501(c)(3)
              IRS-registered organization. EIN 41-4925712.
            </p>
            <p className="footer-address">{ADDRESS}</p>
            <p>Organizing before coding.</p>
          </div>
          <nav className="footer-legal" aria-label="Legal">
            {LEGAL_LINKS.map((link) => (
              <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
