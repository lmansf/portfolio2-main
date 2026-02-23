function updateTime() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; 
    const timeElement = document.getElementById('time');
    if (timeElement) {
        timeElement.textContent = `Tampa (US) ${hours}:${minutes} ${ampm}`;
    }
}

// Initial call
updateTime();
// Update every minute
setInterval(updateTime, 60000);
