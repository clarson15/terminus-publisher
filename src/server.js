import fs from 'fs';
import 'dotenv/config';
import fetch from 'node-fetch';
import ICAL from 'ical.js';

async function getCalendar() {
  const response = await fetch(process.env.PRIVATE_ICAL_URL);
  const icsText = await response.text();
  return ICAL.parse(icsText);
};

async function getWeather() {
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${process.env.LATITUDE}&longitude=${process.env.LONGITUDE}&daily=weather_code,temperature_2m_max,temperature_2m_min&current=temperature_2m,relative_humidity_2m,weather_code&timezone=${process.env.TIME_ZONE}&temperature_unit=fahrenheit`);
  const weather = await response.json();
  return weather;
};

async function postNewDashboard() {
  console.log('Publishing new dashboard');
  const dashboardTemplate = fs.readFileSync('public/template.html', 'utf8');
  const calendar = await getCalendar();
  const weather = await getWeather();
  const now = new Date(weather.current.time);
  const getDayName = date => date.toLocaleDateString('en-US', { weekday: 'long' });
  const getMonthName = date => date.toLocaleDateString('en-US', { month: 'long' });
  const daysUntil = date => {
      if (date < now) date.setFullYear(now.getFullYear() + 1);
      const diff = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
      return diff;
  };

  // update dates
  const targetDate = new Date(`${process.env.TARGET_DATE}T00:00`);
  let newHtml = dashboardTemplate.replace("{{day}}", getDayName(now)).replace("{{date}}", `${getMonthName(now)} ${now.getDate()}`)
    .replace("{{countdown}}", daysUntil(targetDate))
    .replace("{{target_date}}", `${targetDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`);
    
  // update weather
  console.log(`Weather: ${JSON.stringify(weather)}`);
  newHtml = newHtml.replace("{{temp}}", Math.round(weather.current.temperature_2m)).replace("{{weather}}", `${weatherCodeToText(weather.current.weather_code)}`)
    .replace("{{weather_details}}", `High: ${Math.round(weather.daily.temperature_2m_max[0])}°F<br>Low: ${Math.round(weather.daily.temperature_2m_min[0])}°F<br>Humidity: ${weather.current.relative_humidity_2m}%`);
  for (var i = 1; i < 6; i++) {
    newHtml = newHtml.replace(`{{day+${i}}}`, getDayName(new Date(`${weather.daily.time[i]}T12:00`)))
      .replace(`{{low+${i}}}`, Math.round(weather.daily.temperature_2m_min[i]))
      .replace(`{{high+${i}}}`, Math.round(weather.daily.temperature_2m_max[i]))
      .replace(`{{icon${i}}}`, weatherCodeToIconSrc(weather.daily.weather_code[i]));
  }

  // update calendar visual
  const comp = new ICAL.Component(calendar);
  const vevents = comp.getAllSubcomponents('vevent');

  const events = vevents
      .map(event => new ICAL.Event(event))
      .filter(event => event.startDate.toJSDate() >= now)
      .sort((a, b) => a.startDate.toJSDate() - b.startDate.toJSDate())
    .slice(0, 5);
  newHtml = newHtml.replace("{{month_label}}", `${getMonthName(now)} ${now.getFullYear()}`);
  
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
  const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);
  
  // Calculate the first day of the week (0 = Sunday, 6 = Saturday)
  const firstDayOfWeek = firstDayOfMonth.getDay();
  
  // Calculate days from previous month to show
  const daysFromPrevMonth = firstDayOfWeek;
  const prevMonthLastDay = new Date(currentYear, currentMonth, 0).getDate();
  
  // Calculate days in current month
  const daysInMonth = lastDayOfMonth.getDate();
  
  // Fill in the calendar cells
  for (let i = 0; i < 42; i++) {
    let cellContent = '';
    
    if (i < daysFromPrevMonth) {
      // Previous month days
      const day = prevMonthLastDay - daysFromPrevMonth + i + 1;
      cellContent = `<span class="prev-month">${day}</span>`;
    } else if (i < daysFromPrevMonth + daysInMonth) {
      // Current month days
      const day = i - daysFromPrevMonth + 1;
      const isToday = day === now.getDate();
      
      if (isToday) {
        cellContent = `<span class="today">${day}</span>`;
      } else {
        cellContent = day;
      }
      
      // Check if this day has events
      const dayDate = new Date(currentYear, currentMonth, day);
      const hasEvents = events.some(event => {
        const eventDate = event.startDate.toJSDate();
        return eventDate.getDate() === day && 
               eventDate.getMonth() === currentMonth &&
               eventDate.getFullYear() === currentYear;
      });
      
      if (hasEvents) {
        cellContent = `<span class="has-event">${cellContent}</span>`;
      }
    } else {
      // Next month days
      const day = i - (daysFromPrevMonth + daysInMonth) + 1;
      cellContent = `<span class="next-month">${day}</span>`;
    }
    
    // Replace the placeholder with the cell content
    newHtml = newHtml.replace(`{{${i}}}`, cellContent);
  }
  
  if (events.length === 0) {
    newHtml = newHtml.replace("{{upcoming_events}}", "<p>No events</p>");
  } else {
    let count = 0;
    const eventList = events.map(ev => {
      if (count >= 5) return '';
      const date = ev.startDate.toJSDate();
      const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
      const shortDate = date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
      const startTime = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const endTime = ev.endDate.toJSDate().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const title = ev.summary;
      count++;
      return `<li>(${shortDate}) ${weekday}<br> ${title}<br>${startTime} - ${endTime}</li>`;
    }).join('');
    newHtml = newHtml.replace("{{upcoming_events}}", `<ul>${eventList}</ul>`);
  }

  const local = new Date();
  const response = await fetch(`${process.env.TERMINUS_URL}/api/screens`, {
    method: 'POST',
    headers: {
      'Access-Token': process.env.DEVICE_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      image: {
        content: JSON.stringify(newHtml),
        file_name: `dashboard-${local.getFullYear()}-${local.getMonth() + 1}-${local.getDate()}-${local.getHours()}-${local.getMinutes()}.html`,
      }
    })
  });
  const data = await response.json();
  if (response.ok) {
    console.log('Dashboard published successfully:', data);
  } else {
    console.error('Error publishing dashboard:', data);
  }
}

function weatherCodeToIconSrc(code) {
  switch (code) {
    case 0:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A98ZtweOORRKF+u3PQkVzMF5qF/4Y1S0vl8vUIQ8Bc4RZCRwQeB/n3ovINDv9XW+tNXWDUI+XNvMCZFUcgjvwKq6TpI8Vq2sayzyQyOwtrYOVRFBx278UAWp7zUbDwxpdpYr5moTBIA4w6xkDkk8jj/PSumVtoSOSRTKV+m7HUgVx+raSvhRV1nRmeOKNlFxbFyyOpOO/fmrVnBodhq7X13q6z6hJyhuJgDGrDgAduDQAXk+h2GrrY2mkrPqEnDi3hAMasOST24NVdJ1YeFFbRtZV44Y2Y21yELI6k57d+a7Bl2h5I41MpX6bsdATXMwWeo2HhjVLu+bzNQmDzlDh1jIHAA5HH+elAFXVtWXxWq6NoyvJFIym5uShVEUHPfvxVqzn0O/1drG70hYNQj4QXEIJkVRwQe/Aons9Qv8Awxpd3Yt5eoQhJwgwiyEjkEcD/PvXTKu4JJJGolC/XbnqAaAP/9k=';
    case 1:
    case 2:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A9y1LURp1qLkxmSJZFWYqf9Wp6t744/Csx/EscU+pruin8iSNLaKJxulLKOP++jjPasHxIkzzw/6Bc6YL24WC4mEylZVPqqk8+9WdU0vwppSofP8Ast1bESDyJsytjtg55NAHZq2QAcB8AlQc4p1cPpjeIoYHvdP0m2WKf5z9plLTzDsSxI/Dp9K6XQ9ai1qzaVY2hnibZNC3VG9KAMPVrlofEEkOm2c2o6r5ZcNLINlqpH8I6D1/HrzVjQPDFkukI+pWKy3spLTNONzbsnv2p+paTqtvrj6voz27STRiOaG4zg46EY+gpvn+M/8An00n/vp//iqAOmxgYFcdqsVz4Y1d9bgmD2d5Mq3UBXBHoQfz/Orfn+M/+fTSf++n/wDiqibSNd1y6g/tt7SKygcSGC3yfMYdM57fjQB//9k=';
    case 3:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A9/pkkscMbSSuqRqMszHAA9zWVr2v2+i2btuSS7OBFb7vmYnpx1xWUfD+taw0B1zUIza7hJJaRLtHsMjrQBrw+J9EuLgQR6jAZCcAEkAn2J4rWrKuvDmkXVk1q1hAi4wrRxhWX3BFY/hzWnsTFoerrPFcqxSCWVCFlUHgA/y/CgCl4Zi0m4a8n1cwNqouWMguGAK4PGAa7D+0rH/n9tv+/q/41WvvD2k6lP513YxySnq/Kk/XBGaq/wDCG+H/APoHJ/38f/GgDT/tKw/5/bb/AL+r/jXMeML201GCz0+yljuL+S4UxeUwYpjqSR0/z6Vqf8Ib4f8A+gcn/fx/8au6foemaW5eys44nPBcZLY+p5oA/9k=';
    case 45:
    case 48:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A98Zg2+OORRKF+u3PQkVx0niBz4b1Kx1edINUjWSHn5fNyOCoH/6vzpPEM2ieZLq1lqqRapCvHkSg+aRwFI7/AOetM0EeH0t1vtVvrO51K4/eStO6tsJ/hAPTFAEkfiBx4b02x0mdJ9UkVIePm8rA5LA//q/KuxVtoSOSRTKV+m7HUgVy+saPp91pjaxorQw3VuDLHNbYAfb1Bxwe9VvD8miiSHV77VUl1OZc/v5gDFngqB2/woAv6xpUVuY20/wzZXpckyE7E2+nXrnmsr7Jff8AQj2P/f2OtZ/BtvI7OdV1YZOcC5H/AMTVW98J2tlYz3R1LWJBDGz7FuBk4GcfdoAsaedVmjOmzaBHp9jLG6NJDMnyZB5CjvmqmiRaCbpNIuNL8u/gyFNzCC0oHO7Pf1/xqaTTLufwzp0+kz3X2qErcRrcS5Z88lWPA7/5zXUKu4JJJGolC/XbnqAaAP/Z';
    case 51:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A99kkSKNpJGVEUZZmOAB6muXvfGdvM62ehr9svpX2JlSEHqSTjNU7mXVvGUc0VmIYNIWYIzuxDygHnH+fxrsLe0t7SFIreFI0QYUKuMUAc1JD4ws4jdfbrS8Kjc1qIgMj0UgAmtzR9Vh1nTIr2EFQ/DIeqsOoq/XF6rYnwnNHq2nXEot5JwLm2dsqwbuPegCeHS/EGgyzQaQLS5sZJDIiTkho89uoqf7V4y/58NM/77b/AOKrpqgvRcNYzi0KrcmNvKLdA2OP1oAwPtXjL/nw0z/vtv8A4qo/7I1vW7u3fXHtobS3cSC3t8nzGHTOc8fjU/hHTdUsoLubVmY3M8gOHk3nAHqM+tdHQB//2Q==';
    case 53:
    case 55:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A921C/t9MsZbu6fbFGMnHU+gHvXMS6lr+vrFb2VhNptrO3N27ZYJ6gcYz/k1Bp2nzeMFk1HUL6ZbdbgiK0Q/IoX+8PWu3oA5STwVHBEZtP1G9ivlGVlaXIY/7XHT/ADzV/wANa8ur2IS4eNdQiJSaLIByON2PStyuP8X2dtp62eqWUaQagtyoUxjaZc5yCB1oAn1Hw7BYyz31trU2lQytulVW+Qt7DIpY/DupSxrInii9KMAynb1B/GrHibwz/wAJF9l/0toBCTkbdwIOPfrxTfE+r3Ph7SIBYweYzERB2BIQAcZ96AKV9pF3ptq1zeeLbyKJeNxXqfQDPJqXQdEtr37NrNxfXeoMMmD7TwEwcZxk88Vfl0lfEHhyzg1UyiUokrsmFYPt54xjueMVp2VnDp9lFaW6kRRLtUE5NAH/2Q==';
    case 61:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A99kkSKNpJGVEUZZmOAB6muXvfGdvM62ehr9svpX2JlSEHqSTjNU7mXVvGUc0VmIYNIWYIzuxDygHnH+fxrsLe0t7SFIreFI0QYUKuMUAc1JD4ws4jdfbrS8Kjc1qIgMj0UgAmtzR9Vh1nTIr2EFQ/DIeqsOoq/XF6rYnwnNHq2nXEot5JwLm2dsqwbuPegCeHS/EGgyzQaQLS5sZJDIiTkho89uoqf7V4y/58NM/77b/AOKrpqgvRcNYzi0KrcmNvKLdA2OP1oAwPtXjL/nw0z/vtv8A4qo/7I1vW7u3fXHtobS3cSC3t8nzGHTOc8fjU/hHTdUsoLubVmY3M8gOHk3nAHqM+tdHQB//2Q==';
    case 63:
    case 65:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A921C/t9MsZbu6fbFGMnHU+gHvXMS6lr+vrFb2VhNptrO3N27ZYJ6gcYz/k1Bp2nzeMFk1HUL6ZbdbgiK0Q/IoX+8PWu3oA5STwVHBEZtP1G9ivlGVlaXIY/7XHT/ADzV/wANa8ur2IS4eNdQiJSaLIByON2PStyuP8X2dtp62eqWUaQagtyoUxjaZc5yCB1oAn1Hw7BYyz31trU2lQytulVW+Qt7DIpY/DupSxrInii9KMAynb1B/GrHibwz/wAJF9l/0toBCTkbdwIOPfrxTfE+r3Ph7SIBYweYzERB2BIQAcZ96AKV9pF3ptq1zeeLbyKJeNxXqfQDPJqXQdEtr37NrNxfXeoMMmD7TwEwcZxk88Vfl0lfEHhyzg1UyiUokrsmFYPt54xjueMVp2VnDp9lFaW6kRRLtUE5NAH/2Q==';
    case 66:
    case 67:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A911C/t9MsZby6fbFGMnHUnsB71zMuoeINfWKC0sJdNtJ2+a7Z8uE9hwRn/JqDTdOk8YCTUtRvZhAtwRFaIRsUL/eHrXb0AcpJ4IhgiMun395DfKMrM0udx/2uOlXvDOvLq9iI7iSNdQiJSaLIBJHG7HpW7XH+MLS2sFs9Ts40h1BblQhjGDJnOQQOv8An1oAlvdAtYNWxZa1Pps94S/kRtw5HUgf59qk/wCEY1P/AKGe/wDy/wDr07WPDc2o6vFOk4SBpUllbP7xCgIAQ+hz+B571pa89xHpjGAuqbgJ3j++kX8RX3x+maAMefw9f21vJPL4qvkjjUuzEHgDk96peGLO3vtWlk1G4u7nULTDRJctkKhAKsB68jjsa3vDD31x4dgOqIDIykDdyWTsW96t6Zo1npPnG1Rt0rZZnOTgcBQfQDgCgD//2Q==';
    case 71:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A97nnitoHnnkWOJBuZmOABXK3Pi6XUmSz0C2me4mfatxNHiNR3Yf/AFxVYx6p41SVxcR22kLPtWLblpQp6k/5/TNdrHGkUaxxqERRhVUYAFAHLSaN4ltIjdW+vNc3CjcYJIgEf2HPH6fhWzoWrprWlR3YXZJkrJH/AHWHUVpVxev6dD4amh1vTC8LmcLPCGJWUNnPB/z+VAFpdA1rSp5hod/bpaSuZPJuFJ2E+hAPFOaHxgmN+oaUuTgZVhk+n3a6isnxDptxqmm/Z7eVkcsO6gdepyCeOvGD70AZNufFd3EssGp6S6MocEK3Q9DjbUsXh/VNQvoLjXr+KaK3bfHbwLhC3qeBS+DtIvNLsm+1s4MiqwQ7ccgdeNwIxjqRXTUAf//Z';
    case 73:
    case 75:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A911C/t9MsZby6fbFGMnHUnsB71zMuoeINfWKC0sJdNtJ2+a7Z8uE9hwRn/JqDTdOk8YCTUtRvZhAtwRFaRkbFC/3h6129AHKSeCIYIjLp9/eQ3yjKzNLncf9rjpV7wzry6tYiO4kjXUIiUmiyASRxux6Vu1x/jC0trBbPU7ONIdQW5UIYxgyZzkEDr/n1oATWdJs9Lu3uLfV7vTTctuaGE/K53AEjkD+LOM9M1NbaDe3duk8Him/eJ87WwRnnGetWPEvho64Y3STay4yNx+bke+BgFu2c4pl7pV9YeHY7TT33XCyDDKHJLZwpGW+UYAznI68UARS6BfxWzXH/CUXxQLuBDAA+nJbHNZ/h8aVfa1HJNf3uoXcX3DdEBYzgHgE8nJxx3B9jV3wfaXsmkSR33+qkiUR70J+XHy4ySuAO2OvWtDSvCtnpV89zEzMxb5QwB42jrnvkE5GPvUAf//Z';
    case 77:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A911C/t9MsZby6fbFGMnHUnsB71zMuoeINfWKC0sJdNtJ2+a7Z8uE9hwRn/JqDTdOk8YCTUtRvZhAtwRFaRkbFC/3h6129AHKSeCIYIjLp9/eQ3yjKzNLncf9rjpV7wzry6tYiO4kjXUIiUmiyASRxux6Vu1x/jC0trBbPU7ONIdQW5UIYxgyZzkEDr/n1oATWdJs9Lu3uLfV7vTTctuaGE/K53AEjkD+LOM9M1NbaDe3duk8Him/eJ87WwRnnGetWPEvho64Y3STay4yNx+bke+BgFu2c4pl7pV9YeHY7TT33XCyDDKHJLZwpGW+UYAznI68UARS6BfxWzXH/CUXxQLuBDAA+nJbHNZ/h8aVfa1HJNf3uoXcX3DdEBYzgHgE8nJxx3B9jV3wfaXsmkSR33+qkiUR70J+XHy4ySuAO2OvWtDSvCtnpV89zEzMxb5QwB42jrnvkE5GPvUAf//Z';
    case 80:
    case 81:
    case 82:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A921C/t9MsZbu6fbFGMnHU+gHvXMS6lr+vrFb2VhNptrO3N27ZYJ6gcYz/k1Bp2nzeMFk1HUL6ZbdbgiK0Q/IoX+8PWu3oA5STwVHBEZtP1G9ivlGVlaXIY/7XHT/ADzV/wANa8ur2IS4eNdQiJSaLIByON2PStyuP8X2dtp62eqWUaQagtyoUxjaZc5yCB1oAn1Hw7BYyz31trU2lQytulVW+Qt7DIpY/DupSxrInii9KMAynb1B/GrHibwz/wAJF9l/0toBCTkbdwIOPfrxTfE+r3Ph7SIBYweYzERB2BIQAcZ96AKV9pF3ptq1zeeLbyKJeNxXqfQDPJqXQdEtr37NrNxfXeoMMmD7TwEwcZxk88Vfl0lfEHhyzg1UyiUokrsmFYPt54xjueMVp2VnDp9lFaW6kRRLtUE5NAH/2Q==';
    case 85:
    case 86:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A911C/t9MsZby6fbFGMnHUnsB71zMuoeINfWKC0sJdNtJ2+a7Z8uE9hwRn/JqDTdOk8YCTUtRvZhAtwRFaRkbFC/3h6129AHKSeCIYIjLp9/eQ3yjKzNLncf9rjpV7wzry6tYiO4kjXUIiUmiyASRxux6Vu1x/jC0trBbPU7ONIdQW5UIYxgyZzkEDr/n1oATWdJs9Lu3uLfV7vTTctuaGE/K53AEjkD+LOM9M1NbaDe3duk8Him/eJ87WwRnnGetWPEvho64Y3STay4yNx+bke+BgFu2c4pl7pV9YeHY7TT33XCyDDKHJLZwpGW+UYAznI68UARS6BfxWzXH/CUXxQLuBDAA+nJbHNZ/h8aVfa1HJNf3uoXcX3DdEBYzgHgE8nJxx3B9jV3wfaXsmkSR33+qkiUR70J+XHy4ySuAO2OvWtDSvCtnpV89zEzMxb5QwB42jrnvkE5GPvUAf//Z';
    case 95:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A9d17X47OGZUna2urZllVJlwtwo6qp7g57cg1hN4of7RevHDdWa6jJGsFzcJhIxtCs36EjFWdYtLrUNTs7FdQOpNDcrLNAYVVY1HXcwGOnGDzzWprOuMl+ulWGmjUbsASMhICR46Ek9/y7UAamnalb6gHFsZZI4sL57LhZD32nv07cVerkLfQNS1xpbrW7q6tPmKw2tvIFWMDv3BqTQ9Rm03W7nw/qN755TDWssh+ZgRnaT3PP86ANLxN9ph8OXz6epWcqCTGMNjI3H64zWJ4Xn8M2k8QsbuQ3txGI3SQN8zdT2xnPviu0rB0W+ttV1C/KaWkAtZAiytGAztzk9OOg/OgCCw1ye+8T38IniTT7QFduBudwOcd8DB6egrK8R6rp3iAWdppBNzqHnqUkSMgxgdTkgcVtaL4etrLVL+/WAIJXMcSHJwg4Y8/3iD+H1qTRTetqWoifTorO2RgkGxAC4ycnI69qAP/2Q==';
    case 96:
    case 99:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A92v7+302ylu7p9kUYyT3PoB71zMuqa9r6xQWGnzadbTNk3jt8wT1A4xmoNOsJvGAk1HUL2ZbVbgiKzjOFAX+97121AHKSeCxBEZtP1O+ivlGVleXIY+4x0/zzV/w1rq6vYBZ3jW/iJSaIEA5Bxux6VuVx/i+zttOFpq1lGkOoLcqFMYwZc5yCB1oAuT+FGS8muNM1W508TNvkijGVLeoGRisrxbNcaT4ch0yXUHubi6l5mkG0hAQT098frXc1i+ItJXV4Le18pcySqJJdo3JGOTg9s4A/GgClb6Q95pFiNI1ue2to49u6OP/AFpzy3OD1zU1l4VWO/jvdR1C41GeHmLzeFQ+uMnmt6GKOCFIYkCRooVVHQAdBT6AP//Z';
    default:
      return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA+Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBkZWZhdWx0IHF1YWxpdHkK/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A96upxa2k1wwJESM5A74Ga4TwzcQ+K72+GsK88oAeJN7BEToQADx256135AZSCAQeCD3qhY6RpmjmaW0to4N4zI2T0H16CgDzK7urzwn4luLexuZPKhcEIzZVlIBAI+hxmvWLWdbq0huFBCyxq4B7AjNeYppV14y8SXN7GjRWLy8zMMfKMAAepwB9K9QiiSGFIoxhEUKo9AOlAD6p6tayX2l3FrE21pl2Zzjg9f0zVyuJ+IN1qdvHafZZJo7U58x4iR83YEigDsoIIraBIIUWOJBtVVGABUlYfhGW/m8PQPqG8ykna0n3mTsTW5QB/9k=';
  }
}

function weatherCodeToText(code) {
  switch (code) {
    case 0:
      return 'Clear';
    case 1:
    case 2:
      return 'Partly Cloudy';
    case 3:
      return 'Overcast';
    case 45:
    case 48:
      return 'Fog';
    case 51:
      return 'Light Drizzle';
    case 53:
    case 55:
      return 'Drizzle';
    case 61:
      return 'Light Rain';
    case 63:
    case 65:
      return 'Rain';
    case 66:
    case 67:
      return 'Freezing Rain';
    case 71:
      return 'Light Snow';
    case 73:
    case 75:
      return 'Snow';
    case 77:
      return 'Snow Grains';
    case 80:
    case 81:
    case 82:
      return 'Rain Showers';
    case 85:
    case 86:
      return 'Snow Showers';
    case 95:
    case 96:
    case 99:
      return 'Thunderstorm';
    default:
      return 'Unknown';
  }
}

function shutdown() {
  console.log('📴 Graceful shutdown requested');
  clearInterval(timer);
  process.exit(0);
}

postNewDashboard();
var timer = setInterval(postNewDashboard, 1000 * 60 * 10); // Every 10 minutes

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);