package com.sasanka.market;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URL;
import java.util.*;

import org.json.JSONArray;
import org.json.JSONObject;

import common.ExcelOperation;

public class AmfiNavFetcherCode {

	private static final String AMFI_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";

	public static void main(String[] args) throws Exception {

		List<String> mySchemeCodes = new ArrayList<>();

		JSONObject excel_data_mf = ExcelOperation.getExcelDataAsJsonObject(
				"C:\\Users\\Sasanka_Talukder\\OneDrive - Dell Technologies\\Pictures\\sasanka\\personal\\Bank info\\mutual fund\\4\\MUTUAL FUND ACCIUNT.xlsx");

		System.out.println(excel_data_mf);

		try {
			JSONArray sheet1_data = excel_data_mf.getJSONArray("Sheet1");
			for (int i = 0; i < sheet1_data.length(); i++) {
				String schem_code = sheet1_data.getJSONObject(i).getInt("AMF code") + "";
//				System.out.println(schem_code);
				mySchemeCodes.add(schem_code);
//				System.out.println(beforeHyphen);
			}
		} catch (Exception e) {
			System.out.println("error parsing");
		}

		Map<String, String> schemeToNav = loadSchemeNavMap();

		for (String scheme : mySchemeCodes) {
			String nav = schemeToNav.getOrDefault(normalize(scheme), "NOT FOUND");
			System.out.println(scheme + " => " + nav);
		}
	}

	// ================= LOAD AMFI DATA =================
	private static Map<String, String> loadSchemeNavMap() throws Exception {

		Map<String, String> map = new HashMap<>();

		URL url = new URL(AMFI_URL);
		BufferedReader br = new BufferedReader(new InputStreamReader(url.openStream()));

		String line;
		while ((line = br.readLine()) != null) {

			if (!line.contains(";"))
				continue;

			String[] parts = line.split(";");
			if (parts.length < 6)
				continue;

			// ✅ CORRECT COLUMNS
			String schemeCode = parts[0];
			String nav = parts[4];

			
//			else if (!map.containsKey(normalizedBase) && schemeName.toLowerCase().contains("direct")) {
//				map.put(normalizedBase, nav);
//			} else if (!map.containsKey(normalizedBase) || schemeName.toLowerCase().contains("direct")) {
				map.put(schemeCode, parts[1]);
//			}
		}

		return map;
	}

	// ================= NORMALIZATION =================
	private static String normalize(String s) {
		return s.toLowerCase().replace("&amp;", "and").replace("&", "and").replaceAll("[^a-z0-9 ]", "")
				.replaceAll("\\s+", " ").trim();
	}
}
