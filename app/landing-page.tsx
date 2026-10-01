import Link from 'next/link'
import Image from 'next/image'
import styles from './landing-page.module.css'

const JOIN_HREF = '/sign-in?intent=join'

function MarkArtwork({ small = false }: { small?: boolean }) {
  return <Image width={363} height={345} sizes="30px" className={small ? styles.markSmall : styles.mark} src="/landing/evening-quill-mark.webp" alt="" />
}

function DispatchCard({ hero = false }: { hero?: boolean }) {
  return (
    <article className={hero ? styles.heroDispatch : styles.dispatchCard}>
      <p className={styles.eyebrow}>A DISPATCH</p>
      <h3>The Dangerous Myth of Finding Your Calling</h3>
      <div className={styles.byline}>
        <MarkArtwork small />
        <span>Evening Quill</span>
      </div>
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
          <Link className={styles.keepReading} href="/dispatches">Keep reading →</Link>
        </>
      )}

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
  return <Image width={950} height={866} sizes="(max-width: 699px) 1px, 50vw" className={styles.heroCollage} src="/landing/hero-collage.webp" alt="A Tempa Dispatch, personal Mark, letter and illustrated postcard" loading="eager" fetchPriority="high" />
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
            <span>Meet people through</span>
            <em>what they write.</em>
          </h1>
          <p className={styles.tagline}>Let what you say come first.</p>
          <p className={styles.intro}>Begin with a name you choose and the things you actually want to say. Read other people the same way. When someone’s words stay with you, write them a private letter.</p>
          <p className={styles.reveal}>You can reveal more of yourself when and if you want to.</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryButton} href={JOIN_HREF}>Enter Tempa</Link>
            <a className={styles.textLink} href="#read">Read a Dispatch →</a>
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
          <h2>Start with something <em>they had to say.</em></h2><p>A Dispatch is something someone chose to share — a thought, a story, a question, or simply something that stayed on their mind.</p>
        </div>
        <DispatchCard />
        <p className={styles.curious}>Curious about the person behind it?</p>
      </section>

      <section className={`${styles.section} ${styles.markSection}`}>
        <div className={styles.sectionCopy}>
          <p className={styles.eyebrow}>A MARK</p>
          <h2>Behind every piece of writing is a person.</h2>

        </div>
        <div className={styles.markStage}>
          <Image width={708} height={675} sizes="330px" className={styles.markScene} src="/landing/mark-scene.webp" alt="Evening Quill’s abstract personal Mark" loading="lazy" />
          <p>Evening Quill</p>
        </div>
        <p>Every Mark begins with a photograph that means something to its owner. The photograph never leaves their device. <em>Everyone else sees only the Mark it becomes.</em></p>
      </section>

      <section className={`${styles.section} ${styles.questionSection}`}>
        <div className={styles.sectionCopy}>
          <p className={styles.eyebrow}>A QUESTION</p>
          <h2>Questions worth answering.</h2>
        </div>
        <article className={styles.questionCard}>
          <p className={styles.questionLabel}>THIS WEEK’S QUESTION</p>
          <blockquote>What did you believe at twenty that you’ve quietly let go of?</blockquote>
        </article>
        <div className={styles.answerCard}>
          <p className={styles.answerByline}><MarkArtwork small /> Evening Quill answered</p>
          <p className={styles.answer}>“That being busy and being needed were the same thing. They are not. One of them fills a calendar. The other fills a life.”</p>
        </div>
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
        <Image width={327} height={540} sizes="(max-width: 699px) 40vw, 280px" className={styles.momentPhoto} src="/landing/moment-photo.webp" alt="Rain on a window overlooking a green neighbourhood" loading="lazy" />
        <div className={styles.sectionCopy}>
          <p className={styles.eyebrow}>A MOMENT</p>
          <p>A photograph placed exactly where the story needs it — so the reader can stand where you stood, <em>for a second.</em></p>
          <p className={styles.quietNote}>Tap to open. Close it to keep reading.</p>
        </div>
      </section>

      <section className={styles.arrivalBand}>
        <Image width={384} height={261} sizes="(max-width: 699px) 40vw, 220px" className={styles.envelopeArt} src="/landing/envelope.webp" alt="" loading="lazy" />
        <p>Not every message<br />needs to be instant.<br /><strong>Some are worth waiting for.</strong></p>
      </section>

      <section className={`${styles.section} ${styles.peopleSection}`}>
        <div className={styles.sectionCopy}>
          <p className={styles.eyebrow}>PEOPLE</p>
          <h2>People are more interesting <em>than profiles.</em></h2>
        </div>
        <div className={styles.peopleList}>
          {people.map((person) => (
            <article className={styles.person} key={person.name}>
              <Image width={156} height={156} sizes="62px" className={styles.personMark} src={`/landing/${person.kind}-mark.webp`} alt="" loading="lazy" />
              <div>
                <h3>{person.name}</h3>
                <p className={styles.personQuote}>{person.quote}</p>
                <p className={styles.latest}><span>Latest ·</span> {person.latest}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
        <section className={styles.consentCopy}>
          <p>What you say comes first.</p>
          <p>Photos only when you <em>both</em> say yes.</p>
          <p>You can always decline — kindly.</p>
        </section>

      <section className={`${styles.section} ${styles.postcardSection}`}>
        <p className={styles.eyebrow}>A POSTCARD · STORIES WE CARRY</p>
        <Image width={810} height={930} sizes="(max-width: 699px) 90vw, 530px" className={styles.postcardScene} src="/landing/postcard-scene.webp" alt="An illustrated mountain-lake postcard, with Lowtide’s handwritten note to Evening Quill on its back" loading="lazy" />
        <div className={styles.sectionCopy}>
          <h2>Places carry stories too.</h2>
          <p>Illustrated Postcards you write on, front and back. Tuck one into a letter, or send it on its own.</p>
        </div>
      </section>

      <section className={styles.closing}>
        <div className={styles.closingThread} aria-hidden="true" />
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
