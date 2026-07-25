/* =========================================================
   MA DIGITAL SPORTS — shared site script
   Injects the nav and footer into every page
   ========================================================= */

const PAGES = [
  { href:"index.html",    label:"Live Score" },
  { href:"schedule.html", label:"Schedule" },
  { href:"news.html",     label:"News" },
  { href:"blog.html",     label:"Blog" },
  { href:"about.html",    label:"About" },
  { href:"faq.html",      label:"FAQ" }
];

function currentPage(){
  const f = location.pathname.split("/").pop();
  return f === "" ? "index.html" : f;
}

function buildNav(){
  const here = currentPage();
  const links = PAGES.map(p =>
    `<a href="${p.href}"${p.href === here ? ' aria-current="page"' : ''}>${p.label}</a>`
  ).join("");

  return `
  <header class="nav">
    <div class="nav-in">
      <a class="logo" href="index.html">
        <span class="mark">MA</span>
        <span class="txt">MA Digital<small>Sports</small></span>
      </a>
      <nav class="nav-links" id="navLinks">${links}</nav>
      <a class="nav-cta" href="index.html"><span class="led"></span>Live</a>
      <button class="burger" id="burger" aria-label="Menu" aria-expanded="false">&#9776;</button>
    </div>
  </header>`;
}

function buildFooter(){
  const col = (title, items) =>
    `<div><h4>${title}</h4>${items.map(i => `<a href="${i[1]}">${i[0]}</a>`).join("")}</div>`;

  return `
  <footer class="footer">
    <div class="wrap">
      <div class="footer-grid">
        <div>
          <a class="logo" href="index.html" style="margin-bottom:14px">
            <span class="mark">MA</span>
            <span class="txt">MA Digital<small>Sports</small></span>
          </a>
          <p style="color:var(--mut);font-size:14.5px;max-width:36ch">
            Ball-by-ball live cricket scores, match news and analysis.
          </p>
        </div>
        ${col("Coverage", [["Live Score","index.html"],["Schedule","schedule.html"],["News","news.html"]])}
        ${col("Read",     [["Blog","blog.html"],["About","about.html"],["FAQ","faq.html"]])}
        ${col("Follow",   [["YouTube","#"],["Facebook","#"],["Contact","about.html#contact"]])}
      </div>
      <div class="fine">
        <span>&copy; ${new Date().getFullYear()} MA Digital Sports</span>
        <span>Scores supplied by a third-party cricket data API</span>
      </div>
    </div>
  </footer>`;
}

/* ---------- inject ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const navSlot = document.querySelector("[data-nav]");
  const ftSlot  = document.querySelector("[data-footer]");
  if (navSlot) navSlot.outerHTML = buildNav();
  if (ftSlot)  ftSlot.outerHTML  = buildFooter();

  /* burger */
  const burger = document.getElementById("burger");
  const links  = document.getElementById("navLinks");
  if (burger) burger.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    burger.setAttribute("aria-expanded", open);
    burger.innerHTML = open ? "&times;" : "&#9776;";
  });

  initReveal();
  initFaq();
  initCardGlow();
});

/* ---------- scroll reveal ---------- */
function initReveal(){
  const items = document.querySelectorAll(".rv");
  if (!items.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e, i) => {
      if (!e.isIntersecting) return;
      setTimeout(() => e.target.classList.add("in"), i * 70);
      io.unobserve(e.target);
    });
  }, { threshold:.12, rootMargin:"0px 0px -40px 0px" });
  items.forEach(el => io.observe(el));
}

/* ---------- FAQ ---------- */
function initFaq(){
  document.querySelectorAll(".faq-q").forEach(q => {
    q.addEventListener("click", () => {
      const item = q.closest(".faq-item");
      const ans  = item.querySelector(".faq-a");
      const open = item.classList.toggle("open");
      ans.style.maxHeight = open ? ans.scrollHeight + "px" : "0";
    });
  });
}

/* ---------- card cursor glow ---------- */
function initCardGlow(){
  document.querySelectorAll(".card").forEach(c => {
    c.addEventListener("pointermove", e => {
      const r = c.getBoundingClientRect();
      c.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100) + "%");
      c.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100) + "%");
    });
  });
}

/* ---------- marquee helper ----------
   items = array of HTML strings. The track is filled twice
   so the loop is seamless.                                 */
function fillMarquee(el, items, opts = {}){
  if (!el) return;
  const track = el.querySelector(".marquee-track") || el;
  const html  = items.map(t => `<span>${t}</span>`).join(
    `<span class="sep">&#9670;</span>`
  );
  track.innerHTML = html + `<span class="sep">&#9670;</span>` + html;
  if (opts.dur) el.style.setProperty("--dur", opts.dur + "s");
}
window.fillMarquee = fillMarquee;
