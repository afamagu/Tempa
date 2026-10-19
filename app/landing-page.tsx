import Link from 'next/link'
import TempaEmblem from './tempa-emblem'
import styles from './landing-page.module.css'

const JOIN_HREF = '/sign-in?intent=join'

const discoveries = [
  {
    number: '01',
    genre: 'A LITTLE FAMILY HUMOUR',
    title: 'My mother is still waiting for a doctor.',
    paragraphs: [
      "My mother still introduces me as someone who's going to become a doctor.",
      "I'm forty-one. I've been an architect for eleven years.",
      'Last Christmas, she asked whether it was too late to reconsider.',
      "I've started telling people she's a retired surgeon.",
      'She was an accountant.',
    ],
  },
  {
    number: '02',
    genre: 'CULTURE & EXPERIENCE',
    title: 'The thing I miss about home.',
    paragraphs: [
      'When people ask what I miss about my country, I usually say the food.',
      "It's easier than explaining that I miss being rude in my first language and knowing exactly how rude I'm being.",
    ],
  },
  {
    number: '03',
    genre: 'RELATIONSHIPS & REGRET',
    title: 'I told her not to marry him.',
    paragraphs: [
      'Twenty years ago, I told my best friend not to marry her fiancé.',
      'I gave her a list.',
      'It had headings.',
      "They're celebrating their twentieth anniversary next month, and I've been asked to give a toast.",
      "I'm still deciding whether to apologise or pretend the list never existed.",
    ],
  },
]

const steps = [
  {
    number: '01',
    title: 'Discover',
    context: 'THE BOARD',
    description: 'Explore open letters on The Board.',
    detail: 'Different lives, different perspectives, and different things worth talking about.',
  },
  {
    number: '02',
    title: 'Correspond',
    context: 'A PRIVATE LETTER',
    description: 'When something catches your attention, write privately to the person behind it.',
    detail: 'You already have something to talk about.',
  },
  {
    number: '03',
    title: 'See where it leads',
    context: 'THE LETTERBOX',
    description: 'Some exchanges are brief.',
    detail: 'Others grow into correspondence you look forward to.',
  },
]

function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <span className={footer ? styles.footerBrand : styles.brand}>
      <TempaEmblem size={footer ? 27 : 34} priority={!footer} className={styles.emblem} />
      <span>Tempa</span>
    </span>
  )
}

function FeaturedLetter() {
  return (
    <div className={styles.letterShowcase}>
      <span className={styles.letterBackdrop} aria-hidden="true" />
      <article className={styles.featuredLetter} aria-labelledby="featured-letter-title">
        <div className={styles.letterTopline}>
          <span>AN OPEN LETTER</span>
          <span className={styles.letterMark} aria-hidden="true">✳</span>
        </div>
        <h2 id="featured-letter-title">The offer I worked fifteen years for</h2>
        <div className={styles.letterText}>
          <p>Yesterday, they offered me the partnership I&apos;ve been working towards for fifteen years.</p>
          <p>I thanked everyone. Shook their hands. Let them open the champagne.</p>
          <p>Then I went home and spent three hours looking at furniture-making courses.</p>
          <p>I think I&apos;ve spent half my life chasing an ambition that belonged to a younger version of me.</p>
          <p>Has anyone else worked this hard for something they no longer want?</p>
        </div>
        <p className={styles.illustrativeLabel}>Illustrative open letter</p>
      </article>
    </div>
  )
}

export default function LandingPage() {
  return (
    <main className={styles.page} id="top">
      <header className={styles.nav}>
        <a href="#top" className={styles.brandLink} aria-label="Tempa home">
          <Brand />
        </a>
        <nav aria-label="Landing page navigation">
          <a className={styles.howNav} href="#how-it-works">How it works</a>
          <Link href="/sign-in">Sign in</Link>
          <Link className={styles.navJoin} href={JOIN_HREF}>Join Tempa <span aria-hidden="true">↗</span></Link>
        </nav>
      </header>

      <section className={styles.hero} aria-labelledby="hero-heading">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>DISCOVER PEOPLE BEYOND YOUR EVERYDAY WORLD</p>
          <h1 id="hero-heading">The world is full of conversations <em>you haven&apos;t had.</em></h1>
          <div className={styles.heroDescription}>
            <p>There are people you&apos;ve never met with stories you&apos;d love to hear, opinions you&apos;d love to challenge, and experiences nothing like your own.</p>
            <p>On Tempa, you discover them through open letters. Find something that catches your attention, write privately to the person behind it, or leave a letter of your own and see who responds.</p>
          </div>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href={JOIN_HREF}>Join Tempa <span aria-hidden="true">↗</span></Link>
            <a className={styles.secondaryLink} href="#how-it-works">See how it works <span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <FeaturedLetter />
      </section>

      <section className={styles.discovery} aria-labelledby="discovery-heading">
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>A WORLD OF DIFFERENT VOICES</p>
            <h2 id="discovery-heading">You never know what someone <em>might have to say.</em></h2>
            <p className={styles.sectionLead}>A different perspective. An outrageous family story. A question you&apos;ve never considered.</p>
            <p className={styles.sectionLead}>Sometimes, the most interesting conversations begin with someone you&apos;d never otherwise meet.</p>
          </div>
          <div className={styles.discoveryGrid}>
            {discoveries.map((letter) => (
              <article className={styles.discoveryCard} key={letter.number}>
                <div className={styles.discoveryCardTop}>
                  <span>{letter.genre}</span>
                  <span aria-hidden="true" className={styles.discoveryStar}>✳</span>
                </div>
                <h3>{letter.title}</h3>
                <div className={styles.discoveryText}>
                  {letter.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                </div>
                <p className={styles.exampleLabel}>Illustrative open letter</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.howSection} id="how-it-works" aria-labelledby="how-heading">
        <div className={styles.sectionInner}>
          <div className={styles.howIntro}>
            <p className={styles.eyebrow}>HOW TEMPA WORKS</p>
            <h2 id="how-heading">An interesting conversation <em>can begin anywhere.</em></h2>
          </div>
          <ol className={styles.steps}>
            {steps.map((step) => (
              <li className={styles.step} key={step.number}>
                <span className={styles.stepNumber}>{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
                <p>{step.detail}</p>
                <span className={styles.stepContext}>{step.context}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={styles.reassurance} aria-labelledby="reassurance-heading">
        <div className={styles.reassuranceInner}>
          <div>
            <p className={styles.eyebrow}>YOUR VOICE IS ENOUGH</p>
            <h2 id="reassurance-heading">You don&apos;t have to be a writer <em>to have something to say.</em></h2>
          </div>
          <div className={styles.reassuranceCopy}>
            <p>Ask a question. Share an opinion. Tell a ridiculous story. Write about something you&apos;ve been thinking about for days.</p>
            <p>It doesn&apos;t have to be clever or beautifully written.</p>
            <p>It just has to be something you want to talk about.</p>
          </div>
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="closing-heading">
        <div className={styles.closingInner}>
          <span className={styles.closingMark} aria-hidden="true">✳</span>
          <h2 id="closing-heading">Come see who <em>catches your attention.</em></h2>
          <p>You don&apos;t have to know who you&apos;re looking for.</p>
          <p>Start with a story, a question, or an opinion that interests you.</p>
          <Link className={styles.closingButton} href={JOIN_HREF}>Join Tempa <span aria-hidden="true">↗</span></Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <Brand footer />
        <p>Discover people through letters.</p>
        <nav aria-label="Legal links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <span>© 2026</span>
        </nav>
      </footer>
    </main>
  )
}
