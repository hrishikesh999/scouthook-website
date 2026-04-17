(function () {
  function updateNav() {
    var nav = document.getElementById("site-nav");
    if (!nav) return;
    if (window.scrollY > 60) nav.classList.add("nav-scrolled");
    else nav.classList.remove("nav-scrolled");
  }
  window.addEventListener("scroll", updateNav, { passive: true });
  updateNav();
})();
