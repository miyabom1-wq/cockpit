import unittest
from types import SimpleNamespace
import jp_margin_daily as daily
import update_jp_margin as core

class DailyTests(unittest.TestCase):
    def test_share_column_layout_variants(self):
        for x in [227.75,228.7114]:
            self.assertTrue(daily.is_share_marker({'text':'株','x0':x,'top':124}))
        for text,x,top in [('株',70,124),('株',228,50),('金',228,124)]:
            self.assertFalse(daily.is_share_marker({'text':text,'x0':x,'top':top}))

    def test_html_without_charset_header(self):
        from unittest.mock import patch
        import requests
        response=requests.Response()
        response.status_code=200
        response.encoding='ISO-8859-1'
        response._content='<html><meta charset="UTF-8"><table><tr><td>2026年9月30日申込分</td><td><a href="/20260930_mtall.pdf">PDF</a></td></tr></table></html>'.encode('utf-8')
        with patch.object(core.requests,'get',return_value=response):
            html=core.get(daily.PAGE)
        self.assertEqual(daily.discover(html,core.LinkWithDate).date,'2026-09-30')

    def test_discovery_ignores_notices_and_weekly(self):
        html='''<a href="/notice.pdf">2026年10月1日</a><table>
<tr><td>2026年9月29日申込分</td><td><a href="/20260929_mtall.pdf">PDF</a></td></tr>
<tr><td>2026年9月28日申込分</td><td><a href="/20260928_mtall.pdf">PDF</a></td></tr></table>'''
        self.assertEqual(daily.discover(html,core.LinkWithDate).date,'2026-09-29')
        with self.assertRaises(ValueError):daily.discover(html.replace('9月29日','9月30日'),core.LinkWithDate)
        with self.assertRaises(ValueError):daily.discover('<a href="/weekly.pdf">PDF</a>',core.LinkWithDate)
    def test_history_exact_business_date_and_bounded(self):
        old=core.active_table;core.active_table=lambda *args:[]
        try:
            previous={}
            dates=['2026-09-25','2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-05']
            for i,date in enumerate(dates):
                r={'1301.T':{'symbol':'1301.T','name':'極洋','buy_balance':100+i*10,'sell_balance':50,'buy_change':10,'sell_change':0}}
                previous=daily.build(core,r,core.LinkWithDate(date,'https://www.jpx.co.jp/test.pdf',''),previous,1,{'as_of':date,'published_date':date,'parser':'test'})
                self.assertLessEqual(len(previous['items']['1301.T']['history']),6)
                if i==2:self.assertIsNone(previous['items']['1301.T']['daily']['buy_5d_change_pct'])
            item=previous['items']['1301.T']['daily']
            self.assertEqual(item['five_day_as_of'],'2026-09-28')
            self.assertAlmostEqual(item['buy_5d_change_pct'],45.45)
            self.assertEqual(daily.trading_back('2026-09-24'),'2026-09-18')
            with self.assertRaises(ValueError):daily.build(core,r,core.LinkWithDate('2026-09-30','',''),previous,1,{'as_of':'2026-09-30'})
        finally:core.active_table=old
    def test_sparse_history_is_not_five_observations(self):
        old=core.active_table;core.active_table=lambda *args:[]
        try:
            r={'1301.T':{'symbol':'1301.T','name':'極洋','buy_balance':100,'sell_balance':0,'buy_change':0,'sell_change':0}}
            previous={'schema':daily.SCHEMA,'items':{'1301.T':{'history':[{'as_of':d,'buy_balance':100,'sell_balance':0} for d in ['2026-09-01','2026-09-02','2026-09-03','2026-09-04','2026-09-07']]}}}
            result=daily.build(core,r,core.LinkWithDate('2026-09-29','',''),previous,1,{'as_of':'2026-09-29','published_date':'2026-09-30','parser':'test'})
            self.assertIsNone(result['items']['1301.T']['daily']['buy_5d_change_pct'])
            self.assertIsNone(result['items']['1301.T']['daily']['ratio'])
        finally:core.active_table=old
if __name__=='__main__':unittest.main()
