document.addEventListener('DOMContentLoaded', () => {
  document.querySelector('.btn-primary')?.addEventListener('click', () => {
    window.close();
  });

  document.querySelector('.btn-secondary')?.addEventListener('click', () => {
    window.open(
      chrome.runtime.getURL('popup.html'),
      '_blank',
      'width=390,height=620,left=200,top=80'
    );
  });
});
