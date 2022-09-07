/**
 * Simple date wrapper.
 */
function DateWrapper(date, options = {}) {
  // Set the options with defaults.
  this.options = {
    months: options.months || ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    weekDays: options.weekDays || ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    utc: typeof options.utc !== 'undefined' ? options.utc === true : true,
    formats: options.formats || /(YYYY|YY|MMMM|MMM|MM|M|DDDD|DDD|DD|D|dddd|ddd|dd|d|hh|mm|ss)/g
  };

  // Placeholder for the inner javascript object.
  this.dateObject = null;

  // Set the date.
  this.create = date => {
    this.dateObject = typeof date === 'undefined' || date === null ? new Date() : new Date(date);
    return this;
  };

  // Set the date as a UTC date.
  this.utc = date => {
    if (typeof date !== 'undefined') {
      this.create(date);
    }
    this.options.utc = true;
    return this;
  };

  // Set/Get the day part the date.
  this.day = day => {
    if (typeof day === 'number') {
      this.add('date', day - this.get('day'));
      return this;
    }
    return this.get('day');
  };

  // Alias of "date".
  this.days = days => {
    return this.date(days);
  };

  // Alias of "milliseconds".
  this.millisecond = millisecond => {
    return this.milliseconds(millisecond);
  };

  // Set/Get the millisecond part of the date.
  this.milliseconds = milliseconds => {
    return this.set('milliseconds', milliseconds);
  };

  // Alias of "seconds".
  this.second = second => {
    return this.seconds(second);
  };

  // Set/Get the second part of the date.
  this.seconds = seconds => {
    return this.set('seconds', seconds);
  };

  // Alias of "minutes".
  this.minute = minute => {
    return this.minutes(minute);
  };

  // Set/Get the minute part of the date.
  this.minutes = minutes => {
    return this.set('minutes', minutes);
  };

  // Alias of "hours".
  this.hour = hour => {
    return this.hours(hour);
  };

  // Set/Get the hour part of the date.
  this.hours = hours => {
    return this.set('hours', hours);
  };

  // Get/Set the date part of the date.
  this.date = date => {
    return this.set('date', date);
  };

  // Alias of "date".
  this.dates = dates => {
    return this.date(dates);
  };

  // Set/Get the month part of the date.
  this.month = month => {
    return this.set('month', month);
  };

  // Alias of "month".
  this.months = months => {
    return this.month(months);
  };

  // Set/Get the year part of the date.
  this.year = year => {
    return this.set('year', year);
  };

  // Alias of "year".
  this.years = years => {
    return this.year(years);
  };

  // Get the "type" part of the date.
  this.get = type => {
    return this.set(type);
  };

  // Set the "type" part of the date to "value" if defined otherwise get the
  // value of the "type" part of the date.
  this.set = (type, value) => {
    type = type === 'year' ? 'FullYear' : type;
    type = type.charAt(0).toUpperCase() + type.slice(1);
    if (typeof value === 'number') {
      this.dateObject['set' + (this.options.utc ? 'UTC' : '') + type](value);
      return this;
    }
    return this.dateObject['get' + (this.options.utc ? 'UTC' : '') + type]();
  };

  // Get the number of days in the date's month.
  this.daysInMonth = () => {
    var date = new Date(this.year(), this.month() + 1, 0);
    return this.options.utc ? date.getUTCDate() : date.getDate();
  };

  // Add the "value" from the "type" port of the date.
  this.add = (type, value) => {
    return this[type](this[type]() + value);
  };

  // Substract the "value" from the "type" port of the date.
  this.substract = (type, value) => {
    return this[type](this[type]() - value);
  };

  // Get the unix timestamp in milliseconds.
  this.valueOf = () => {
    return this.dateObject.valueOf();
  };

  // Get the unix timestamp in seconds.
  this.unix = () => {
    return Math.round(this.valueOf() / 1000);
  };

  // Get the date in ISO format.
  this.iso = () => {
    return this.dateObject.toISOString().replace(/(\.\d+)?Z$/, '+00:00');
  };

  // Format the date.
  this.format = format => {
    return format.replace(this.options.formats, this.replace);
  };

  // Replace placeholder in a date forma,t
  this.replace = data => {
    let day;
    let date;
    let month;

    switch (data) {
      case 'YYYY':
        return this.year();

      case 'YY':
        return String(this.year()).slice(-2);

      case 'MMMM':
        return this.options.months[this.month()];

      case 'MMM':
        return String(this.options.months[this.month()]).substr(0, 3);

      case 'MM':
        month = this.month() + 1;
        return (month < 10 ? '0' : '') + month;

      case 'M':
        return this.month() + 1;

      case 'DDDD':
      case 'DDD':
        date = new Date(this.year(), 0, 1);
        date = String(Math.ceil((this.dateObject - date) / 86400000));
        return (data === 'DDDD' ? '00'.substr(0, 2 - date.length) : '') + date;

      case 'DD':
        date = this.date();
        return (date < 10 ? '0' : '') + date;

      case 'D':
        return this.date();

      case 'dddd':
      case 'ddd':
      case 'dd':
        day = this.options.weekDays[this.get('day')];
        return data === 'dddd' ? day : day.substr(0, data.length);

      case 'd':
        return this.get('day');

      case 'hh':
        var hours = this.get('hours');
        return (hours < 10 ? '0' : '') + hours;

      case 'mm':
        var minutes = this.get('minutes');
        return (minutes < 10 ? '0' : '') + minutes;

      case 'ss':
        var seconds = this.get('seconds');
        return (seconds < 10 ? '0' : '') + seconds;
    }
  };

  // Get the number of days between 2 dates.
  this.diffDays = date => {
    return Math.round((this.unix() - this.clone(date).unix()) / 86400).toFixed();
  };

  // Clone the date wrapper using the given date or the original one.
  this.clone = date => {
    return new DateWrapper(date || this.dateObject, this.options);
  };

  // Check if the date is invalid.
  this.invalid = () => {
    return isNaN(this.dateObject);
  };

  // Initialize the date to given one or to "now".
  this.create(date);
}

exports.DateWrapper = DateWrapper;
