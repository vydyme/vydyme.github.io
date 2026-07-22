// Keyboard navigation for the photo page: left/right arrows to move between photos.
// Clicking the photo itself toggles a fullscreen zoom; escape exits the zoom.
(function () {
  var view = document.querySelector(".photo-view");
  if (!view) return;

  var prev = document.querySelector(".photo-nav__arrow--prev");
  var next = document.querySelector(".photo-nav__arrow--next");
  var image = view.querySelector(".photo-view__image");

  function isZoomed() {
    return image && image.classList.contains("is-zoomed");
  }

  if (image) {
    image.addEventListener("click", function () {
      image.classList.toggle("is-zoomed");
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isZoomed()) {
      image.classList.remove("is-zoomed");
      return;
    }
    if (e.key === "ArrowLeft" && prev) window.location.href = prev.href;
    if (e.key === "ArrowRight" && next) window.location.href = next.href;
  });
})();
