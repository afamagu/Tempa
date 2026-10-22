import Link from 'next/link'
import styles from './landing-page.module.css'

const JOIN_HREF = '/sign-in?intent=join'

const steps = [
  {
    number: '01',
    title: 'Leave a letter or find one',
    paragraphs: [
      'Leave a letter on The Board. Tell someone about your day, a thought, or something that has been on your mind.',
      'Someone, somewhere, might find something in your words that makes them want to know you.',
      'You can also explore letters others have left and write to anyone who interests you. Or look for someone by place or language if you already know the kind of person you want.',
      'Or let Tempa introduce you to six potential pen pals based on what brings you here and what you have in common.',
    ],
  },
  {
    number: '02',
    title: 'Write when you have something to say',
    paragraphs: [
      'There is no daily inbox to keep up with.',
      'Write when you are ready. A quiet week is a pace, not a disappearance.',
      'Keep a few correspondences at a time. Get to know people through their letters, at your own pace.',
    ],
  },
  {
    number: '03',
    title: 'They write back, or they don’t',
    paragraphs: [
      'A reply begins the correspondence.',
      'Some letters become lasting friendships. Others remain a single exchange.',
      'You can send a postcard with your letter if you want.',
      'The letter is the main thing.',
    ],
  },
]

function FeaturedLetter() {
  return (
    <div className={styles.letterShowcase} aria-label="Illustration of a letter left on The Board and a private reply">
      <div className={styles.showcaseAura} aria-hidden="true" />
      <article className={styles.featuredLetter}>
        <div className={styles.letterTopline}>
          <span className={styles.tinyDiamond} aria-hidden="true">✧</span>
          <span>LETTER LEFT ON THE BOARD</span>
        </div>
        <h2>The woman at the orange stand</h2>
        <p>
          All summer, a woman sold oranges from a small stand outside the corner shop on my way home.
          I passed her almost every evening, but I never learned her name.
        </p>
        <p>Yesterday, she wasn’t there. I was surprised by how much I noticed.</p>
        <div className={styles.letterSignature}>— Sandra <span>·</span> Toronto, Canada</div>
      </article>
      <div className={styles.privateReply} aria-hidden="true">
        <p className={styles.replyEyebrow}>A PRIVATE LETTER, IN REPLY</p>
        <p className={styles.replySalutation}>Dear Sandra,</p>
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

      <section className={styles.hero} id="top" aria-labelledby="landing-heading">
        <div className={styles.heroCopy}>
          <h1 id="landing-heading" className={styles.heroHeading}>Pen pals restored.</h1>
          <p className={styles.heroLead}>
            Write to someone about an ordinary day.<br />
            If something in it stays with you, write them.
          </p>
          <p className={styles.heroThesis}>You meet someone through what they wrote, not through a photo or a profile.</p>
          <div className={styles.heroBody}>
            <p>Tempa is a place for pen pals. Real letters, not messages that expect a reply tonight.</p>
            <p>Meet people from other places through the letters they leave about their lives. Write privately when something catches your interest. Take your time getting to know someone.</p>
          </div>
          <p className={styles.heroPromise}>No followers. No feed to keep up with. Just letters.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href={JOIN_HREF}>Enter Tempa <span aria-hidden="true">↗</span></Link>
            <a className={styles.secondaryLink} href="#read">How it works <span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <FeaturedLetter />
      </section>

      <div className={styles.sectionRule} aria-hidden="true"><span>✧</span></div>

      <section className={styles.howSection} id="read" aria-labelledby="how-heading">
        <div className={styles.sectionIntro}>
          <h2 id="how-heading">How Tempa works</h2>
        </div>
        <ol className={styles.steps}>
          {steps.map((step) => (
            <li className={styles.step} key={step.number}>
              <span className={styles.stepNumber}>{step.number}</span>
              <h3>{step.title}</h3>
              {step.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.closing} aria-labelledby="closing-heading">
        <span className={styles.closingOrnament} aria-hidden="true">✧</span>
        <h2 id="closing-heading">Someone, somewhere, wrote about an ordinary day.</h2>
        <p>If something in it stays with you, write them.</p>
        <Link className={styles.primaryButton} href={JOIN_HREF}>Enter Tempa <span aria-hidden="true">↗</span></Link>
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
