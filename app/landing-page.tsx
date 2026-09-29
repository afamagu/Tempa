import Link from 'next/link'
import styles from './landing-page.module.css'

const JOIN_HREF = '/sign-in?intent=join'

function MarkArtwork({ small = false }: { small?: boolean }) {
  return (
    <div className={small ? styles.markSmall : styles.mark} aria-hidden="true">
      <span className={styles.markLavender} />
      <span className={styles.markNavy} />
      <span className={styles.markPlum} />
      <span className={styles.markRose} />
      <span className={styles.markInk} />
    </div>
  )
}

function Landscape({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? styles.landscapeCompact : styles.landscape} aria-hidden="true">
      <span className={styles.sky} />
      <span className={styles.sun} />
      <span className={styles.mountainBack} />
      <span className={styles.mountainFront} />
      <span className={styles.ground} />
    </div>
  )
}

function DispatchCard({ hero = false }: { hero?: boolean }) {
  return (
    <article className={hero ? styles.heroDispatch : styles.dispatchCard}>
      <p className={styles.eyebrow}>A DISPATCH</p>
      <h3>The Dangerous Myth of Finding Your Calling</h3>
      {hero ? (
        <p className={styles.heroDispatchExcerpt}>
          Somewhere along the way we were promised that each of us has one calling, buried like treasure…
        </p>
      ) : (
        <>
          <p className={styles.dispatchBody}>
            Somewhere along the way we were promised that each of us has one calling, buried like treasure, and that a good life is the long search for it.
          </p>
          <p className={styles.dispatchBody}>
            I believed this for eleven years. I believed it through two careers, one move across the world and a great many personality tests.
          </p>
          <p className={styles.dispatchBody}>
            Here is what I wish someone had told me sooner: a calling is rarely found. It is mostly built, badly at first, by people who kept showing up…
          </p>
          <span className={styles.keepReading}>Keep reading →</span>
        </>
      )}
      <div className={styles.byline}>
        <MarkArtwork small />
        <span>Evening Quill</span>
      </div>
    </article>
  )
}

function LetterCard({ hero = false }: { hero?: boolean }) {
  return (
    <article className={hero ? styles.heroLetter : styles.letterCard}>
      {!hero && <p className={styles.letterMeta}>A LETTER YOU MIGHT WRITE · IN LINEN</p>}
      <p className={styles.salutation}>Dear Evening Quill,</p>
      {hero ? (
        <p>
          I read your piece about callings twice. The second time, I was sitting at the window where the rain hasn’t stopped all week.
        </p>
      ) : (
        <>
          <p>I read your piece about callings twice — once on the bus, and once again at midnight, because it wouldn’t leave me alone.</p>
          <p>The second time, I was sitting at the window where the rain hasn’t stopped all week.</p>
          <p>You said a calling is built, badly at first. I think I’ve been waiting to feel certain before starting anything. Can I ask what you built first?</p>
          <p className={styles.signature}>— Someone who read your Dispatch</p>
        </>
      )}
    </article>
  )
}

function HeroCollage() {
  return (
    <div className={styles.heroCollage} aria-label="A Tempa Dispatch, Mark, letter and postcard">
      <div className={styles.heroHalo} aria-hidden="true" />
      <DispatchCard hero />
      <MarkArtwork />
      <LetterCard hero />
      <div className={styles.heroPostcard} aria-hidden="true"><Landscape compact /></div>
      <div className={styles.envelope} aria-hidden="true">
        <span className={styles.envelopeFlap} />
        <span className={styles.envelopeStamp}>TEMPA<br />ARRIVING<br />THURSDAY</span>
      </div>
    </div>
  )
}

const people = [
  {
    name: 'Maya',
    quote: '“I have strong opinions about people who put raisins where raisins don’t belong.”',
    latest: 'The strange intimacy of people you rarely see',
    kind: 'maya',
  },
  {
    name: 'Lowtide',
    quote: '“I keep a list of things strangers have said to me on trains. It’s longer than I’d like to admit.”',
    latest: 'In defence of the slow reply',
    kind: 'lowtide',
  },
  {
    name: 'Second Kettle',
    quote: '“Most of my best decisions were made by accident and defended on purpose.”',
    latest: 'What my grandmother knew about waiting',
    kind: 'kettle',
  },
]

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <a className={styles.wordmark} href="#top" aria-label="Tempa home">Tempa</a>
        <nav aria-label="Landing page navigation">
          <a href="#read">Read</a>
          <Link href="/sign-in">Sign in</Link>
        </nav>
      </header>

      <section className={styles.hero} id="top">
        <div className={styles.heroCopy}>
          <h1>
            <span>People are easy to find.</span>
            <em>They are not easy to know.</em>
          </h1>
          <p className={styles.intro}>
            Tempa is where you meet people through what they write. When something they say stays with you, write them a letter. The writing comes first. <em>Everything else can follow.</em>
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href={JOIN_HREF}>Enter Tempa</Link>
            <a className={styles.textLink} href="#read">Read something first →</a>
          </div>
        </div>
        <HeroCollage />
      </section>

      <div className={styles.mobilePeek} aria-hidden="true">
        <LetterCard hero />
        <DispatchCard hero />
      </div>

      <div className={styles.thread} aria-hidden="true">
        <span /><span /><span />
      </div>

      <section className={`${styles.section} ${styles.dispatchSection}`} id="read">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>A DISPATCH</p>
          <p>Something a member wrote for anyone to read.</p>
        </div>
        <DispatchCard />
      </section>

      <section className={`${styles.section} ${styles.markSection}`}>
        <div className={styles.sectionCopy}>
          <p className={styles.eyebrow}>A MARK</p>
          <h2>Behind every piece of writing is a person.</h2>
          <p>Every Mark begins with a photograph that means something to its owner. The photograph never leaves their device. Everyone else sees only the Mark it becomes.</p>
        </div>
        <div className={styles.markStage}>
          <MarkArtwork />
          <p>Evening Quill</p>
        </div>
      </section>

      <section className={`${styles.section} ${styles.questionSection}`}>
        <div className={styles.sectionCopy}>
          <p className={styles.eyebrow}>A QUESTION</p>
          <h2>Questions worth answering.</h2>
        </div>
        <article className={styles.questionCard}>
          <p className={styles.questionLabel}>THIS WEEK’S QUESTION</p>
          <blockquote>What did you believe at twenty that you’ve quietly let go of?</blockquote>
          <p className={styles.answerByline}>Evening Quill answered</p>
          <p className={styles.answer}>“That being busy and being needed were the same thing. They are not. One of them fills a calendar. The other fills a life.”</p>
        </article>
      </section>

      <section className={`${styles.section} ${styles.letterSection}`}>
        <div className={styles.sectionCopy}>
          <p className={styles.eyebrow}>A LETTER</p>
          <h2>A letter should feel like it came from you.</h2>
          <p>Choose a writing style that sounds like you.</p>
          <div className={styles.typeChoices} aria-label="Example writing styles">
            <span className={styles.typeLinen}>Linen</span>
            <span className={styles.typePencil}>Pencil</span>
            <span className={styles.typeTypewriter}>Typewriter</span>
          </div>
        </div>
        <LetterCard />
      </section>

      <section className={`${styles.section} ${styles.momentSection}`}>
        <div className={styles.momentPhoto} role="img" aria-label="A quiet green landscape beneath a cloudy sky">
          <div className={styles.photoHills} />
        </div>
        <div className={styles.sectionCopy}>
          <p className={styles.eyebrow}>A MOMENT</p>
          <h2>A photograph placed exactly where the story needs it.</h2>
          <p>So the reader can stand where you stood, for a second.</p>
          <p className={styles.quietNote}>Tap to open. Close it to keep reading.</p>
        </div>
      </section>

      <section className={styles.arrivalBand}>
        <div className={styles.arrivalStamp} aria-hidden="true">TEMPA <span>arriving</span> THURSDAY</div>
        <p>Not every message<br />needs to be instant.<br /><strong>Some are worth waiting for.</strong></p>
      </section>

      <section className={`${styles.section} ${styles.peopleSection}`}>
        <div className={styles.sectionCopy}>
          <p className={styles.eyebrow}>PEOPLE</p>
          <h2>People are more interesting than profiles.</h2>
        </div>
        <div className={styles.peopleList}>
          {people.map((person) => (
            <article className={styles.person} key={person.name}>
              <div className={`${styles.personMark} ${styles[person.kind]}`} aria-hidden="true"><span /></div>
              <div>
                <h3>{person.name}</h3>
                <p className={styles.personQuote}>{person.quote}</p>
                <p className={styles.latest}><span>Latest ·</span> {person.latest}</p>
              </div>
            </article>
          ))}
        </div>
        <div className={styles.consentCopy}>
          <p>What you say comes first.</p>
          <p>Photos only when you both say yes.</p>
          <p>You can always decline — kindly.</p>
        </div>
      </section>

      <section className={`${styles.section} ${styles.postcardSection}`}>
        <div className={styles.postcardMock} aria-label="The back of a Stories We Carry postcard">
          <div>
            <p className={styles.postcardLabel}>THE BACK</p>
            <p>Found the lake you wrote about. Quieter than you promised — which I didn’t think was possible.</p>
            <p>— Lowtide</p>
          </div>
          <div className={styles.postcardAddress}>To Evening Quill</div>
          <Landscape compact />
        </div>
        <div className={styles.sectionCopy}>
          <p className={styles.eyebrow}>A POSTCARD · STORIES WE CARRY</p>
          <h2>Places carry stories too.</h2>
          <p>Illustrated Postcards you write on, front and back. Tuck one into a letter, or send it on its own.</p>
        </div>
      </section>

      <section className={styles.closing}>
        <div className={styles.closingThread} aria-hidden="true"><Landscape /></div>
        <p className={styles.steps}>Start with one question.<br />Read someone else’s answer.<br />Write when something stays with you.</p>
        <h2>Find someone worth writing to.</h2>
        <Link className={styles.primaryButton} href={JOIN_HREF}>Enter Tempa</Link>
      </section>

      <footer className={styles.footer}>
        <span>Tempa</span>
        <nav aria-label="Legal links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <span>© 2026</span>
        </nav>
      </footer>
    </main>
  )
}
