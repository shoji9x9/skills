/* 保存結果のメッセージ（注文・利用者の両画面で共通） */
(function ($) {
  var AUTO_CLOSE_MS = 15000;
  var timer = null;

  function close($box) {
    clearTimeout(timer);
    $box.hide("slide", { direction: "up" }, 500);
  }

  window.FeedbackMessage = {
    show: function (kind, text) {
      var $box = $("#feedback-message");
      $box.attr("class", "feedback-message feedback-" + kind);
      $box.find(".feedback-text").text(text);
      $box.show("slide", { direction: "up" }, 600, function () {
        $box.find(".feedback-close").trigger("focus");
        if (kind === "info" || kind === "success") {
          timer = setTimeout(function () {
            close($box);
          }, AUTO_CLOSE_MS);
        }
      });
    },
  };

  $(document).on("click", "#feedback-message .feedback-close", function () {
    close($("#feedback-message"));
  });
})(jQuery);
