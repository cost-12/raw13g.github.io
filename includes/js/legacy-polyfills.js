// Compatibility helpers for the PS4 WebKit runtime.
(function () {
  if (!String.prototype.padStart) {
    String.prototype.padStart = function (targetLength, padString) {
      var value = String(this);
      var target = targetLength >> 0;
      var fill = String(padString === undefined ? " " : padString);
      if (value.length >= target || fill === "") return value;
      var needed = target - value.length;
      while (fill.length < needed) fill += fill;
      return fill.slice(0, needed) + value;
    };
  }

  if (!String.prototype.repeat) {
    String.prototype.repeat = function (count) {
      var remaining = count >> 0;
      if (remaining < 0) throw new RangeError("Invalid count value");
      var value = String(this);
      var result = "";
      while (remaining > 0) {
        if (remaining & 1) result += value;
        remaining >>>= 1;
        if (remaining) value += value;
      }
      return result;
    };
  }
})();
