/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { MK_HEADER_LINKS } from "./marketing-blocks.ts";
import type { ReactNode } from "react";
import type { BlockRenderArgs } from "./types.ts";
import { parseMarkdownToHtml } from "./markdown.ts";
import { SvgIcon } from "./svg-icon.tsx";
import type {
  MkBandProps,
  MkCompanyProps,
  MkDocHeaderProps,
  MkDocSectionProps,
  MkFaqProps,
  MkFooterProps,
  MkPricingProps,
  MkHeaderProps,
  MkFeaturesProps,
  MkFinalCallProps,
  MkHeroProps,
  MkIncludedProps,
  MkStatementProps,
  MkStepsProps,
  MkValuesProps,
} from "./marketing-blocks.ts";

/**
 * Sections of the platform's own website (ADR-042). Server-rendered markup only, styled by marketing.css under `.mk`, so
 * they add nothing to a store's JavaScript. The live name checker and the company details come from the host.
 */

/** Links inside the site stay in the same tab; parseMarkdownToHtml opens every link in a new one. */
const Prose = ({ text }: { text: string | undefined }) => {
  if (!text) return null;
  const html = parseMarkdownToHtml(text).replace(/(href="\/[^"]*")\s+target="_blank"(\s+rel="noopener noreferrer")?/g, "$1");
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
};

function NameChecker({ checker }: { checker: ReactNode }) {
  return checker ?? (
    <div className="mk-sample" aria-hidden="true">
      <span>yourname</span>
      <b>Check name</b>
    </div>
  );
}

export function MkHeroView({ props, ctx }: BlockRenderArgs<MkHeroProps>) {
  return (
    <section className="hero">
      <div className="wrap hero-in solo">
        <div>
          {props.stamp ? <span className="stamp"><b />{props.stamp}</span> : null}
          <h1>{props.title}</h1>
          {props.lead ? <p className="lead">{props.lead}</p> : null}
          {props.showNameChecker ? <NameChecker checker={ctx?.renderNameChecker?.()} /> : null}
          {props.fine ? <p className="fine">{props.fine}</p> : null}
        </div>
      </div>
    </section>
  );
}

export function MkIncludedView({ props }: BlockRenderArgs<MkIncludedProps>) {
  return (
    <section className="strip" aria-label={props.label}>
      <div className="wrap strip-in">
        <span className="kick">{props.label}</span>
        <ul>
          {props.items.map((item) => (
            <li key={item.label}><SvgIcon name={item.icon} px={18} />{item.label}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function MkStatementView({ props }: BlockRenderArgs<MkStatementProps>) {
  return (
    <section className="sec statement">
      <div className="wrap">
        <p className="rv">{props.text} {props.muted ? <span>{props.muted}</span> : null}</p>
      </div>
    </section>
  );
}

export function MkFeaturesView({ props }: BlockRenderArgs<MkFeaturesProps>) {
  return (
    <section className={props.tone === "soft" ? "sec soft" : "sec"}>
      <div className="wrap">
        <div className="head rv">
          {props.eyebrow ? <span className="kick">{props.eyebrow}</span> : null}
          <h2>{props.title}</h2>
          {props.intro ? <p>{props.intro}</p> : null}
        </div>
        <div className="joined bento rv">
          {props.items.map((item) => (
            <article className="cell sm" key={item.title}>
              <div className="cell-t">
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function MkStepsView({ props }: BlockRenderArgs<MkStepsProps>) {
  return (
    <section className="steps" aria-label={props.label}>
      <div className="wrap">
        <ol>
          {props.items.map((item, i) => (
            <li key={item.title} className="rv">
              <span className="step-n"><SvgIcon name={item.icon} px={18} /><code>0{i + 1}</code></span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function MkBandView({ props }: BlockRenderArgs<MkBandProps>) {
  return (
    <section className="band">
      <div className="wrap band-in">
        <h2 className="rv">{props.title}</h2>
        <ul className="stds rv">
          {props.items.map((item) => (
            <li key={item.name}><b>{item.name}</b><span>{item.note}</span></li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function MkFaqView({ props }: BlockRenderArgs<MkFaqProps>) {
  return (
    <section className="sec soft">
      <div className="wrap faq-in">
        <div className="head rv">
          {props.eyebrow ? <span className="kick">{props.eyebrow}</span> : null}
          <h2>{props.title}</h2>
        </div>
        <div className="faq rv">
          {props.items.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function MkFinalCallView({ props, ctx }: BlockRenderArgs<MkFinalCallProps>) {
  return (
    <section className="band cta">
      <div className="wrap">
        <h2>{props.title}</h2>
        {props.text ? <p>{props.text}</p> : null}
        <NameChecker checker={ctx?.renderNameChecker?.()} />
        {props.showPlansLink ? <a className="textlink" href="/pricing">Compare plans <SvgIcon name="arrow-right" px={15} /></a> : null}
      </div>
    </section>
  );
}

export function MkDocHeaderView({ props }: BlockRenderArgs<MkDocHeaderProps>) {
  return (
    <header className="doc-head">
      <div className="doc">
        {props.eyebrow ? <span className="kick">{props.eyebrow}</span> : null}
        <h1>{props.title}</h1>
        {props.intro ? <p className="lead">{props.intro}</p> : null}
      </div>
    </header>
  );
}

export function MkDocSectionView({ props }: BlockRenderArgs<MkDocSectionProps>) {
  return (
    <div className="doc-part">
      <div className="doc">
        {props.heading ? <h2>{props.heading}</h2> : null}
        <Prose text={props.body} />
        {props.checks.length > 0 ? (
          <ul className="checks">
            {props.checks.map((line) => (
              <li key={line}><SvgIcon name="check" px={15} />{line}</li>
            ))}
          </ul>
        ) : null}
        <Prose text={props.after} />
      </div>
    </div>
  );
}

export function MkValuesView({ props }: BlockRenderArgs<MkValuesProps>) {
  return (
    <div className="doc-part">
      <div className="doc">
        {props.heading ? <h2>{props.heading}</h2> : null}
        <div className="joined trio">
          {props.items.map((item) => (
            <div className="cell" key={item.text}><SvgIcon name={item.icon} px={20} /><p>{item.text}</p></div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MkCompanyView({ props, ctx }: BlockRenderArgs<MkCompanyProps>) {
  return (
    <div className="doc-part">
      <div className="doc">
        {props.heading ? <h2>{props.heading}</h2> : null}
        {ctx?.renderCompany?.() ?? <div className="box"><h3>Company details</h3><p>The registered name, address, CIN, GSTIN and contact emails appear here.</p></div>}
        <Prose text={props.after} />
      </div>
    </div>
  );
}

/**
 * Static picture of the header for the editor canvas. On the website the interactive header (mobile menu, theme switch)
 * is drawn from the same props.
 */
export function MkHeaderView({ props, ctx }: BlockRenderArgs<MkHeaderProps>) {
  const menu = ctx?.blockId ? ctx.data?.[ctx.blockId] : undefined;
  const links = menu && menu.kind === "menu" && menu.items.length > 0 ? menu.items.map((i) => ({ label: i.label, href: i.href })) : MK_HEADER_LINKS;
  return (
    <header className="top">
      <div className="wrap top-in">
        <span className="logo"><i>{props.brand.slice(0, 1)}</i>{props.brand}</span>
        <nav className="links" aria-label="Main">
          {links.map((l) => (<a key={l.href + l.label} href={l.href}>{l.label}</a>))}
        </nav>
        <div className="top-acts">
          {props.showThemeToggle ? <span className="iconbtn" aria-hidden="true"><SvgIcon name="moon" px={18} /></span> : null}
          <a className="btn login" href={props.loginHref}>{props.loginLabel}</a>
          <a className="btn pri" href={props.ctaHref}>{props.ctaLabel}</a>
        </div>
      </div>
    </header>
  );
}

/** The footer, on the website and in the editor. */
export function MkFooterView({ props }: BlockRenderArgs<MkFooterProps>) {
  const legal = props.legal.replace("{year}", String(new Date().getFullYear()));
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div className="foot-brand">
            <span className="logo"><i>{props.brand.slice(0, 1)}</i>{props.brand}</span>
            <Prose text={props.about} />
            <address><Prose text={props.contact} /></address>
          </div>
          {props.columns.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h4>{col.title}</h4>
              {col.links.map((l) => (<a key={l.href + l.label} href={l.href}>{l.label}</a>))}
            </nav>
          ))}
        </div>
        <p className="foot-legal">{legal}</p>
      </div>
    </footer>
  );
}

/** The plans table. On the website it shows the live plans from Super Admin; the editor draws a placeholder. */
export function MkPricingView({ props, ctx }: BlockRenderArgs<MkPricingProps>) {
  const live = ctx?.renderPricing?.({ heading: props.heading, description: props.description });
  if (live) return <>{live}</>;
  return (
    <section className="sec" id="pricing">
      <div className="wrap">
        <div className="head center">
          <span className="kick">Pricing</span>
          <h2>{props.heading}</h2>
          <p>{props.description}</p>
        </div>
        <div className="box"><p>The plans, prices and limits from Super Admin &gt; Plans appear here on the live site.</p></div>
      </div>
    </section>
  );
}
