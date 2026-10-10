import Link from 'next/link'
import styles from './landing-page.module.css'

const JOIN_HREF = '/sign-in?intent=join'

const letterGlimpses = [
  {
    name: 'Maya',
    place: 'Nairobi',
    title: 'Sunday lunch',
    excerpt: 'Sunday lunch at two. Nobody leaves before six.',
  },
  {
    name: 'Lowtide',
    place: 'Osaka',
    title: 'The tea I always buy',
    excerpt: 'She knows which tea I buy.',
  },
  {
    name: 'Second Kettle',
    place: 'Porto Alegre',
    title: 'While I make dinner',
    excerpt: 'My brother calls while I make dinner.',
  },
]

const steps = [
  {
    number: '01',
    title: 'Letters left here',
    description: 'People leave something from a real day. A small story, an observation, a memory.',
  },
  {
    number: '02',
    title: 'You read',
    description: 'Find a moment that feels familiar, or a life entirely unlike your own.',
  },
  {
    number: '03',
    title: 'Write to them',
    description: 'Tell the person privately what caught your attention. No public performance.',
  },
  {
    number: '04',
    title: 'A quiet pace',
    description: 'If they write back, a correspondence begins. A quiet week is just a quiet week.',
  },
]

function FeaturedLetter() {
  return (
    <div className={styles.letterShowcase} aria-label="Illustration of a letter left in The Room and a private reply">
      <div className={styles.showcaseAura} aria-hidden="true" />
      <article className={styles.featuredLetter}>
        <div className={styles.letterTopline}>
          <span className={styles.tinyDiamond} aria-hidden="true">✧</span>
          <span>LETTER LEFT IN THE ROOM</span>
        </div>
        <h2>The woman at the orange stand</h2>
        <p>
          Every morning, the same woman sits outside our gate selling oranges.
          I’ve lived here for four years, and until yesterday, I didn’t know her name.
        </p>
        <p>Yesterday, she wasn’t there. I was surprised by how much I noticed.</p>
        <div className={styles.letterSignature}>— Adaeze <span>·</span> Nigeria</div>
      </article>
      <div className={styles.privateReply} aria-hidden="true">
        <p className={styles.replyEyebrow}>A PRIVATE LETTER, IN REPLY</p>
        <p className={styles.replySalutation}>Dear Adaeze,</p>
        <p>I think we all have someone like that. You’ve made me wonder if I know her name.</p>
        <p className={styles.replySignoff}>Yours, a reader</p>
      </div>
      <p className={styles.illustrationNote}>A glimpse of how Tempa works · Illustrative letters</p>
    </div>
  )
}

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <a className={styles.wordmark} href="#top" aria-label="Tempa home">Tempa<span className={styles.wordmarkDot}>.</span></a>
        <nav aria-label="Landing page navigation">
          <a href="#read">How it works</a>
          <Link href="/sign-in">Sign in</Link>
        </nav>
      </header>

      <section className={styles.hero} id="top">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>A QUIETER WAY TO FIND SOMEONE</p>
          <h1>Someone, somewhere, wrote about an <em>ordinary day.</em></h1>
          <p className={styles.heroSecond}>If something in it stays with you, write them.</p>
          <p className={styles.mechanism}>Letters left in The Room. If one stays with you, write the person.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href={JOIN_HREF}>I have an invitation <span aria-hidden="true">↗</span></Link>
            <a className={styles.secondaryLink} href="#read">See how it works <span aria-hidden="true">↓</span></a>
          </div>
          <p className={styles.pilotStatus}>Founding Correspondents <span aria-hidden="true">·</span> Tempa is currently invitation only.</p>
        </div>
        <FeaturedLetter />
      </section>

      <div className={styles.sectionRule} aria-hidden="true"><span>✧</span></div>

      <section className={styles.howSection} id="read" aria-labelledby="how-heading">
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>HOW TEMPA WORKS</p>
          <h2 id="how-heading">A letter can be <em>the beginning.</em></h2>
          <p>Not a profile to perform. Not an audience to build. Just something someone wrote, and the possibility of writing back.</p>
        </div>
        <ol className={styles.steps}>
          {steps.map((step) => (
            <li className={styles.step} key={step.number}>
              <span className={styles.stepNumber}>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.glimpsesSection} aria-labelledby="glimpses-heading">
        <div className={styles.glimpsesInner}>
          <div className={styles.glimpsesHeading}>
            <div>
              <p className={styles.eyebrow}>LETTERS LEFT HERE</p>
              <h2 id="glimpses-heading">There is no such thing as <em>an ordinary life.</em></h2>
            </div>
            <p>No grand introductions required. Sometimes the smallest things stay with us.</p>
          </div>
          <div className={styles.glimpsesGrid}>
            {letterGlimpses.map((letter) => (
              <article className={styles.glimpseCard} key={letter.name}>
                <span className={styles.glimpsePaperMark} aria-hidden="true">✳</span>
                <p className={styles.glimpseTitle}>{letter.title}</p>
                <blockquote>“{letter.excerpt}”</blockquote>
                <p className={styles.glimpseAuthor}>— {letter.name} <span>·</span> {letter.place}</p>
              </article>
            ))}
          </div>
          <p className={styles.exampleDisclaimer}>Illustrative excerpts, showing the kind of ordinary writing that belongs in The Room.</p>
        </div>
      </section>

      <section className={styles.quietSection} aria-labelledby="quiet-heading">
        <div className={styles.quietIcon} aria-hidden="true"><span>✉</span></div>
        <div>
          <p className={styles.eyebrow}>THE LETTERBOX</p>
          <h2 id="quiet-heading">A quiet week is <em>still a good week.</em></h2>
          <p>When someone writes back, take your time getting to know each other. A few real correspondences, at a pace that leaves room for life.</p>
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="closing-heading">
        <span className={styles.closingOrnament} aria-hidden="true">✧</span>
        <p className={styles.eyebrow}>SOMEONE IS OUT THERE</p>
        <h2 id="closing-heading">Find someone you want to <em>keep writing to.</em></h2>
        <p>Every correspondence begins somewhere. Sometimes, it begins with an ordinary day.</p>
        <Link className={styles.primaryButton} href={JOIN_HREF}>I have an invitation <span aria-hidden="true">↗</span></Link>
      </section>

      <footer className={styles.footer}>
        <span className={styles.footerBrand}>Tempa<span>.</span></span>
        <p>Letters left here. People found along the way.</p>
        <nav aria-label="Legal links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <span>© 2026</span>
        </nav>
      </footer>
    </main>
  )
}
