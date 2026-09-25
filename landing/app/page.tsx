'use client'

import { BookOpen, BrainCircuit, Lightbulb, MessageCircle, Sparkles, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { APP_URL } from '@/lib/app-url'
import { ART, imgProps } from '@/lib/art'

const subjects = [
  ['Mathematics', 'Understand the why behind every formula, one clear step at a time.', 'math'],
  ['Science', 'Explore big ideas through questions, examples, and guided experiments.', 'science'],
  ['English & Social Science', 'Build confidence with stories, concepts, and conversations that stick.', 'humanities'],
]

function Arrow() { return <span aria-hidden="true">â†—</span> }

export default function Page() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <main>
      <section className="hero">
        <nav className="nav shell">
          <a className="logo" href="#top" aria-label="Curie home"><img {...imgProps(ART.logo, 'Curie logo', true)} /><span>curie</span></a>
          <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label="Toggle menu">Menu <span>+</span></button>
          <div className={`nav-links ${menuOpen ? 'is-open' : ''}`}><a href="#how">How it works</a><a href="#subjects">Subjects</a><a href="#events">Events</a><a href="#why">Why Curie</a></div>
          {/* `href="#login"` â€” there is no element with id="login" on this page,
              so both of these were buttons that scrolled nowhere. They go to the
              app, which is what a person clicking "Log in" is asking for. */}
          <div className="nav-actions"><a href={APP_URL}>Log in</a><a className="pill dark-pill" href="#start">Try Curie <Arrow /></a></div>
        </nav>
        <div className="hero-content shell" id="top">
          <div className="hero-copy"><p className="eyebrow">Your personal AI tutor, live with you</p><h1>Learning that<br /><em>learns you.</em></h1><p className="hero-desc">Curie is a one-on-one live AI tutor for students in classes 6â€“12. It listens, adapts, and explains every concept at your pace.</p><a className="pill outline-pill" href="#start">Meet your tutor <Arrow /></a></div>
          <div className="hero-art"><img {...imgProps(ART.hero, 'Student learning at a desk in a live online classroom', true)} /></div>
        </div><div className="hero-note">Every student learns<br />a little differently.</div>
      </section>

      <section className="stats shell"><div><strong>1:1</strong><span>Personal tutor</span></div><div><strong>24/7</strong><span>Learn on your time</span></div><div><strong>6â€“12</strong><span>School classes</span></div><div><strong>âˆž</strong><span>Questions welcome</span></div></section>

      <section className="event-section" id="events"><div className="shell event-shell"><div className="event-copy"><p className="event-kicker"><span className="live-dot" /> Live challenge</p><h2>Think fast.<br /><em>Learn big.</em></h2><p>Curie&apos;s first all-India learning sprint is here. Show what you know, sharpen your thinking, and climb the leaderboard.</p><div className="event-details"><span>Classes 6â€“12</span><span>Online</span><span>Limited entries</span></div><a className="pill event-pill" href="/challenge-register">Join the challenge <Arrow /></a></div><div className="prize-board"><div className="prize-head"><span>Curie champion league</span><strong>â‚¹1,00,000+</strong><small>Total prize pool</small></div><div className="prize-list"><article className="prize-card first"><span className="rank">01</span><img {...imgProps(ART.prizeCash, 'Cash prize trophy')} /><div><b>â‚¹1,00,000</b><small>First position</small></div><span className="prize-spark">â˜…</span></article><article className="prize-card second"><span className="rank">02</span><img {...imgProps(ART.prizeConsole, 'Gaming console prize')} /><div><b>PlayStation</b><small>Second position</small></div><span className="prize-spark">â—†</span></article><article className="prize-card third"><span className="rank">03</span><img {...imgProps(ART.prizePhone, 'Blue smartphone prize')} /><div><b>Moto Edge 50</b><small>Third position</small></div><span className="prize-spark">âœ¦</span></article><article className="prize-card small-prize"><span className="rank">04</span><div><b>Surprise prize</b><small>Fourth position</small></div></article><article className="prize-card small-prize"><span className="rank">05</span><div><b>Surprise prize</b><small>Fifth position</small></div></article></div><p className="event-footnote">Five ranks. One unforgettable finish.</p></div></div></section>

      <section className="intro shell" id="how"><div className="intro-art"><img {...imgProps(ART.desk, 'Student using a computer for a personalized live class')} /></div><div className="section-copy"><p className="eyebrow">Not another video library</p><h2>A tutor who <em>meets you</em> where you are.</h2><p>Curie notices what you know, where you get stuck, and how you learn best. Then it changes the lesson in real time so every session feels made for you.</p><a className="text-link" href="#why">See how Curie adapts <Arrow /></a></div></section>

      <section className="why" id="why"><div className="shell"><div className="why-head"><div><p className="eyebrow">The Curie difference</p><h2>More than answers.<br /><em>Real understanding.</em></h2></div><p>Ask anything without fear of being judged. Get hints when you need them, challenge when you are ready, and build the confidence to solve the next one yourself.</p></div><div className="feature-grid"><article className="feature"><span className="icon"><BrainCircuit aria-hidden="true" /></span><h3>Adaptive by design</h3><p>Curie adjusts pace, difficulty, examples, and explanations around your learning curve.</p></article><article className="feature"><span className="icon"><MessageCircle aria-hidden="true" /></span><h3>Live one-on-one</h3><p>A focused conversation, not a crowded classroom or a prerecorded lecture.</p></article><article className="feature"><span className="icon"><Lightbulb aria-hidden="true" /></span><h3>Always patient</h3><p>Ask the same question five ways. Curie will find a sixth way to explain it.</p></article><article className="feature"><span className="icon"><TrendingUp aria-hidden="true" /></span><h3>Progress you can see</h3><p>Know what is clicking, what needs practice, and what to learn next.</p></article></div></div></section>

      <section className="courses" id="subjects"><div className="shell"><div className="courses-heading"><p className="eyebrow">Your syllabus, your way</p><h2>Every subject.<br /><em>One curious mind.</em></h2><p>Curie helps you move from â€œI don&apos;t get itâ€ to â€œI can explain it.â€</p></div><div className="course-grid">{subjects.map(([title, desc, key], i) => <article className="course-card" key={key}><div className={`course-image image-${i}`}><img {...imgProps([ART.learner, ART.focus, ART.teacher][i], `${title} learning illustration`)} /></div><div className="course-meta"><span><BookOpen aria-hidden="true" /> Class 6â€“12</span><span><Sparkles aria-hidden="true" /> Live with Curie</span></div><h3>{title}</h3><p>{desc}</p><a className="mini-link" href="#start">Explore subject <Arrow /></a></article>)}</div></div></section>

      <section className="steps shell"><div className="section-copy"><p className="eyebrow">A better learning loop</p><h2>Learn at your <em>own pace.</em></h2><p>Start with a question. Curie builds the path around your answer, then keeps refining it as you grow.</p><ul><li><b>01</b> Tell Curie what you are learning</li><li><b>02</b> Learn through a live conversation</li><li><b>03</b> Practice until it feels yours</li></ul></div><div className="steps-art"><img {...imgProps(ART.hand, 'Hand holding a phone showing a personalized online lesson')} /></div></section>

      <section className="cta shell" id="start"><div className="cta-art"><img {...imgProps(ART.teacher, 'AI tutor teaching with a rising progress line')} /></div><div><p className="eyebrow">Ready when you are</p><h2>Meet the tutor<br /><em>made for you.</em></h2><p>Try a calmer, more personal way to learn school subjects.</p><a className="pill dark-pill" href={APP_URL}>Start free <Arrow /></a></div></section>

      <section className="app-promo"><div className="shell"><p className="eyebrow">Learning, wherever you are</p><h2>Your next <em>breakthrough</em><br />can start anywhere.</h2><p>Keep your tutor, questions, and progress close with Curie.</p><div className="store-buttons"><a className="play-store-button" href="/mobile-coming-soon"><img src="/art/googleplay.svg" alt="Google Play" width="24" height="24" loading="lazy" decoding="async" /><span>GET IT ON<br /><b>Google Play</b></span></a></div></div></section>

      <footer><div className="shell footer-grid"><div><a className="logo footer-logo" href="#top"><img {...imgProps(ART.logoLight, 'Curie light logo')} /><span>curie</span></a><p>Your one-on-one AI tutor<br />for classes 6â€“12.</p></div><div><b>Learn</b><a href="/subjects">Subjects</a><a href="/how-it-works">How it works</a><a href="/why-curie">Why Curie</a></div><div><b>For families</b><a href="/students">For students</a><a href="/parents">For parents</a><a href="/contact">Contact us</a></div>{/*
            THIS WAS A NEWSLETTER BOX THAT KEPT NOTHING.
            `onSubmit` was `if (email) setJoined(true)` and the page then said
            "You're on the list." There is no list: the address was never sent
            anywhere and was gone on refresh. There is no newsletter table to
            wire it to either, so rather than a second form that lies, this
            points at the one door on this site that does save what it is
            given. Restore a real box the day there is somewhere to put it.
          */}
          <div><b>Stay curious</b><p>Entries for the Champion League are open now.</p><a className="mini-link" href="/challenge-register">Join the challenge <Arrow /></a></div></div><div className="footer-bottom shell"><span>Â© 2026 Curie Learning Co.</span><span>Learning, made personal.</span></div></footer>
    </main>
  )
}
