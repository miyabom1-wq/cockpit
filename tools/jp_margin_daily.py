"""JPX daily share balances (2026-09-28 publication format).
Fail closed on format/column/date changes; keep six actual dated observations.
"""
from datetime import date, timedelta
import io
import re
from urllib.parse import urljoin
import jpholiday
import pdfplumber
from bs4 import BeautifulSoup

PAGE = 'https://www.jpx.co.jp/markets/statistics-equities/margin/01.html'
SCHEMA = 'jp-margin-v2'
# Ratios to listed shares are deliberately excluded; amounts are separate rows.
BOUNDS = [(251,296),(296,338),(369,411),(411,452),(482,522),(522,563),
          (563,602),(602,644),(644,685),(685,726),(726,768),(768,810)]

def trading_back(value, count=1):
    d = date.fromisoformat(value)
    for _ in range(count):
        d -= timedelta(days=1)
        while d.weekday() >= 5 or jpholiday.is_holiday(d) or (d.month == 1 and d.day <= 3) or (d.month == 12 and d.day == 31):
            d -= timedelta(days=1)
    return d.isoformat()

def discover(html, link_type):
    soup = BeautifulSoup(html, 'html.parser')
    found = []
    for a in soup.select('a[href]'):
        href = a['href']
        match = re.search(r'/(20\d{6})_mtall\.pdf$', href)
        if not match:
            continue
        stamp = match[1]
        d = date(int(stamp[:4]), int(stamp[4:6]), int(stamp[6:])).isoformat()
        # Date belongs to this row, never zip unrelated dates and links.
        row = a.find_parent('tr')
        if row is None or not re.search(rf'{int(stamp[:4])}年\s*{int(stamp[4:6])}月\s*{int(stamp[6:])}日\s*申込分', row.get_text(' ', strip=True)):
            raise ValueError('JPX daily link/date mismatch')
        found.append(link_type(d, urljoin(PAGE, href), row.get_text(' ', strip=True)))
    if not found:
        raise ValueError('JPX daily PDF links not found; refusing weekly fallback')
    return max(found, key=lambda x:x.date)

def integer(text):
    text = re.sub(r'[^0-9▲△%,.\-]', '', text).replace(',', '')
    if text == '-': return 0
    if not re.fullmatch(r'(?:▲|△|-)?\d+', text):
        raise ValueError(f'invalid numeric cell: {text!r}')
    return int(text.replace('▲','-').replace('△','-'))

def is_share_marker(char):
    # JPX's 2026-10-02 and 10-05 PDFs differ by ~1 pt horizontally.
    # Keep a narrow unit column; ISIN, code and all numeric totals still validate.
    return char['text'] == '株' and 226 <= char['x0'] <= 230 and char['top'] > 80

def parse_pdf(blob):
    records = {}
    with pdfplumber.open(io.BytesIO(blob)) as pdf:
        first = pdf.pages[0].extract_text() or ''
        if '前日比' not in first or '株数' not in first or '金額' not in first:
            raise ValueError('not JPX daily share/value format')
        m = re.search(r'(20\d{2})/(\d{1,2})/(\d{1,2})\s*申込', first)
        if not m: raise ValueError('PDF application date missing')
        as_of = date(*map(int,m.groups())).isoformat()
        # Publication date printed at upper right; never use fetch time as publication time.
        pub = re.findall(r'(20\d{2})/(\d{1,2})/(\d{1,2})', first)
        published = max(date(*map(int,x)).isoformat() for x in pub)
        observed = 0
        for page in pdf.pages:
            if page.page_number == len(pdf.pages):
                text = page.extract_text() or ''
                if 'sub-total' in text and 'loan trading issue' in text and not re.search(r'JP[A-Z0-9]{10}', text):
                    continue
            if page.width != 842: raise ValueError('unexpected JPX page width')
            chars = page.chars
            markers = [c for c in chars if is_share_marker(c)]
            for marker in markers:
                top = marker['top']
                row = sorted((c for c in chars if abs(c['top']-top)<0.65),key=lambda c:c['x0'])
                def cell(left,right):
                    return ''.join(c['text'] for c in row if left <= (c['x0']+c['x1'])/2 < right)
                if re.search(r'貸借銘柄|制度信用銘柄|合計', cell(30,180)) and '銘柄' in cell(180,228):
                    continue  # Final aggregate page, not an issue
                code = re.sub(r'[^0-9A-Z]', '', cell(180,200))
                if not re.fullmatch(r'(?:\d{4}|\d{3}[A-Z])0',code):
                    if re.fullmatch(r'\d{5}',code): continue  # preferred/nonstandard issues
                    raise ValueError(f'invalid share-row code: {code!r} page={page.page_number} top={top} left={cell(30,250)!r}')
                symbol=code[:4]+'.T'; observed+=1
                if symbol in records: raise ValueError(f'duplicate: {symbol}')
                isin = re.sub(r'[^0-9A-Z]', '', cell(200,229))
                if not re.fullmatch(r'[A-Z]{2}[A-Z0-9]{10}',isin): raise ValueError(f'invalid ISIN: {symbol}')
                v=[integer(cell(a,b)) for a,b in BOUNDS]
                if any(v[i] != v[a]+v[b] for i,a,b in [(0,4,6),(1,5,7),(2,8,10),(3,9,11)]):
                    raise ValueError(f'column totals mismatch: {symbol}')
                if min(v[0],v[2],v[0]-v[1],v[2]-v[3])<0: raise ValueError('negative balance')
                records[symbol]={'symbol':symbol,'name':cell(48,119).replace('普通株式','').strip(),
                    'sell_balance':v[0],'sell_change':v[1],'buy_balance':v[2],'buy_change':v[3]}
            page.close()
        for sym,name in [('1301.T','極洋'),('7203.T','トヨタ'),('9432.T','ＮＴＴ')]:
            if name not in records.get(sym,{}).get('name',''): raise ValueError(f'anchor failed: {sym}')
        if observed < 4000: raise ValueError(f'not enough records: {observed}')
    return records, {'parser':'jpx-daily-shares-v1','as_of':as_of,'published_date':published,'accepted_rows':len(records),'quality_status':'passed'}

def build(core, records, link, previous, min_count, diag):
    if diag['as_of'] != link.date: raise ValueError('HTML / PDF application date mismatch')
    if previous.get('daily',{}).get('as_of','') > link.date: raise ValueError('refusing data rollback')
    # Reuse official restriction-list collection, but discard all weekly comparisons/history.
    data = core.build_dataset(records, link, {}, min_count)
    data['schema']=SCHEMA
    data['daily']=data.pop('weekly')
    data['daily'].update(status='official-jpx-daily',published_at=diag['published_date'])
    data['source']={'publisher':'JPX / Tokyo Stock Exchange','daily_page':PAGE,'parser':diag['parser']}
    data['validation']=diag
    prior_items=previous.get('items',{}) if previous.get('schema')==SCHEMA else {}
    day1=trading_back(link.date); day5=trading_back(link.date,5)
    for sym,item in data['items'].items():
        daily=item.pop('weekly');item.pop('history',None)
        item['daily']=daily
        if not daily:continue
        history={h['as_of']:h for h in prior_items.get(sym,{}).get('history',[]) if day5<=h.get('as_of','')<=link.date}
        history[link.date]={'as_of':link.date,'buy_balance':daily['buy_balance'],'sell_balance':daily['sell_balance']}
        # The official day change supplies the immediately preceding trading day's balance.
        history[day1]={'as_of':day1,'buy_balance':daily['buy_balance']-daily['buy_change'],'sell_balance':daily['sell_balance']-daily['sell_change']}
        base=history.get(day5)
        for k in ['buy_4w_change','buy_4w_change_pct']:daily.pop(k,None)
        daily.update(published_at=data['daily']['published_at'],previous_as_of=day1,five_day_as_of=day5 if base else None)
        for side in ['buy','sell']:
            change=daily[side+'_balance']-base[side+'_balance'] if base else None
            daily[side+'_5d_change']=change
            daily[side+'_5d_change_pct']=round(change/base[side+'_balance']*100,2) if base and base[side+'_balance'] else None
        item['history']=sorted(history.values(),key=lambda h:h['as_of'])[-6:]
    return data
